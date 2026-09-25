import { RefreshToken } from '@/entities/RefreshToken';
import { Role, User } from '@/entities/User';
import AppError, { UnauthorizedError } from '@/helpers/AppError';
import { CryptoHelper } from '@/helpers/CryptoHelper';
import { JwtHelper } from '@/helpers/JwtHelper';
import { AppDataSource } from '@/loaders/database';
import { CookieService } from '@/services/auth/CookieService';
import { ApiResponse } from '@/types/ApiResponse';
import { GoogleAuthValidation, LoginValidation, RefreshTokenValidation, SignupValidation } from '@/validations/AuthValidation';
import envConfig from '@/config/envConfig';
import crypto from 'crypto';
import { In } from 'typeorm';
import { Service } from 'typedi';
import z from 'zod';

@Service()
export class AuthService {
  private static readonly ACCESS_TOKEN_EXPIRES_IN = '10m';
  private static readonly ACCESS_TOKEN_TTL_MS = 10 * 60 * 1000;

  constructor(private cookieService: CookieService) {}

  private userRepository = AppDataSource.getRepository(User);
  private refreshTokenRepository = AppDataSource.getRepository(RefreshToken);

  private generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Issues a refresh token. Only its SHA-256 hash is stored, so a leaked
   * database doesn't hand out live sessions; the returned object carries the
   * raw token (for the cookie / response body) in `.token`.
   */
  private async createRefreshToken(userId: number, userAgent?: string, ipAddress?: string): Promise<RefreshToken> {
    const raw = this.generateRefreshToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const refreshToken = this.refreshTokenRepository.create({
      token: CryptoHelper.hashToken(raw),
      userId,
      expiresAt,
      userAgent,
      ipAddress,
      revoked: false,
    });

    const saved = await this.refreshTokenRepository.save(refreshToken);
    return Object.assign(saved, { token: raw });
  }

  /** Finds a live refresh token by its hash — or, for rows issued before hashing, by the raw value. */
  private findActiveRefreshToken(raw: string): Promise<RefreshToken | null> {
    return this.refreshTokenRepository.findOne({
      where: [
        { token: CryptoHelper.hashToken(raw), revoked: false },
        { token: raw, revoked: false },
      ],
    });
  }

  /** How long a rotated-out refresh token keeps working, so two tabs refreshing at once don't log each other out. */
  private static readonly ROTATION_GRACE_MS = 60_000;

  private buildAccessTokenPayload(user: User) {
    const token = JwtHelper.generateToken(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      AuthService.ACCESS_TOKEN_EXPIRES_IN
    );

    return {
      token,
      expireAt: new Date(Date.now() + AuthService.ACCESS_TOKEN_TTL_MS).toISOString(),
    };
  }

  async login(request: z.infer<typeof LoginValidation>, userAgent?: string, ipAddress?: string): Promise<ApiResponse> {
    const user = await this.userRepository.createQueryBuilder('user').addSelect('user.password').where('user.email = :email', { email: request.email }).andWhere('user.deletedAt IS NULL').getOne();

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Your account has been deactivated');
    }

    const check = await CryptoHelper.verifyPassword(request.password, user.password);
    if (!check.ok) {
      throw new UnauthorizedError('Invalid email or password');
    }
    // Upgrade a legacy SHA-256 password to scrypt now that we know it's right.
    if (check.needsRehash) {
      await this.userRepository.update({ id: user.id }, { password: await CryptoHelper.hashPassword(request.password) });
    }

    const accessToken = this.buildAccessTokenPayload(user);

    const refreshToken = await this.createRefreshToken(user.id, userAgent, ipAddress);

    await this.cookieService.setRefreshToken(refreshToken.token);

    const { password: _, ...userWithoutPassword } = user;

    return {
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        token: accessToken.token,
        refreshToken: refreshToken.token,
        expireAt: accessToken.expireAt,
      },
    };
  }

  async refreshAccessToken(request?: z.infer<typeof RefreshTokenValidation>): Promise<ApiResponse> {
    let refreshTokenString = request?.refresh_token;

    if (!refreshTokenString) {
      refreshTokenString = await this.cookieService.getRefreshToken();
    }

    if (!refreshTokenString) {
      throw new UnauthorizedError('Refresh token not provided');
    }

    const refreshToken = await this.findActiveRefreshToken(refreshTokenString);

    if (!refreshToken) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    if (new Date() > refreshToken.expiresAt) {
      refreshToken.revoked = true;
      await this.refreshTokenRepository.save(refreshToken);
      throw new UnauthorizedError('Refresh token has expired');
    }

    const user = await this.userRepository.findOne({
      where: { id: refreshToken.userId, deletedAt: undefined },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('User not found or inactive');
    }

    const newAccessToken = this.buildAccessTokenPayload(user);

    // Rotate: every refresh issues a fresh refresh token, and the old one stops
    // working after a short grace (so two tabs refreshing together don't knock
    // each other out). A stolen token is therefore only useful briefly.
    const graceUntil = new Date(Date.now() + AuthService.ROTATION_GRACE_MS);
    if (refreshToken.expiresAt > graceUntil) {
      refreshToken.expiresAt = graceUntil;
      await this.refreshTokenRepository.save(refreshToken);
    }
    const rotated = await this.createRefreshToken(user.id, refreshToken.userAgent, refreshToken.ipAddress);
    await this.cookieService.setRefreshToken(rotated.token);

    return {
      status: 'success',
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken.token,
        expire_at: newAccessToken.expireAt,
      },
    };
  }

  async getProfile(userId: number): Promise<ApiResponse> {
    const user = await this.userRepository.findOne({
      where: { id: userId, deletedAt: undefined },
      select: ['id', 'name', 'email', 'phone', 'role', 'isActive', 'created_at', 'updated_at'],
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    return {
      message: 'Profile retrieved successfully',
      data: user,
    };
  }

  async logout(userId?: number, refreshTokenString?: string): Promise<ApiResponse> {
    let tokenToRevoke = refreshTokenString;

    if (!tokenToRevoke) {
      tokenToRevoke = (await this.cookieService.getRefreshToken()) ?? undefined;
    }

    if (tokenToRevoke) {
      await this.refreshTokenRepository.update({ token: In([CryptoHelper.hashToken(tokenToRevoke), tokenToRevoke]) }, { revoked: true });
    } else if (userId) {
      await this.refreshTokenRepository.update({ userId }, { revoked: true });
    }

    await this.cookieService.clearRefreshToken();

    return {
      message: 'Logged out successfully',
    };
  }

  async signup(request: z.infer<typeof SignupValidation>, userAgent?: string, ipAddress?: string): Promise<ApiResponse> {
    const isGuest = request.isGuest ?? false;

    let email = request.email;
    let name = request.name;
    let password = request.password;

    if (isGuest) {
      const guestId = crypto.randomBytes(8).toString('hex');
      email = email || `guest_${guestId}@guest.local`;
      name = name || `Guest_${guestId}`;
      password = password || crypto.randomBytes(16).toString('hex');
    }

    if (email) {
      const existingUser = await this.userRepository.findOne({
        where: { email },
      });

      if (existingUser) {
        throw new AppError('Email already exists', 400);
      }
    }

    const hashedPassword = await CryptoHelper.hashPassword(password!);

    const user = this.userRepository.create({
      name: name!,
      email: email!,
      password: hashedPassword,
      phone: request.phone,
      role: isGuest ? Role.GUEST : Role.USER,
      isActive: true,
    });

    await this.userRepository.save(user);

    const accessToken = this.buildAccessTokenPayload(user);

    const refreshToken = await this.createRefreshToken(user.id, userAgent, ipAddress);

    await this.cookieService.setRefreshToken(refreshToken.token);

    const { password: _, ...userWithoutPassword } = user;

    return {
      message: isGuest ? 'Guest account created successfully' : 'Signup successful',
      data: {
        user: userWithoutPassword,
        token: accessToken.token,
        refreshToken: refreshToken.token,
        expireAt: accessToken.expireAt,
      },
    };
  }

  /**
   * Public sign-in configuration for the browser.
   *
   * The client id is served at runtime rather than baked into the bundle: Vite
   * inlines VITE_ variables at build time, so shipping it that way would mean a
   * rebuild to change it. A Google client id is not a secret.
   */
  getPublicAuthConfig(): ApiResponse {
    return {
      message: 'Auth configuration',
      data: { googleClientId: envConfig.googleClientId || null },
    };
  }

  /**
   * Sign in (or sign up) with a Google ID token from the browser.
   *
   * The token is verified by Google itself. Decoding it here without checking
   * the signature would let anyone mint a token for any email address, so the
   * response is only trusted after the audience, issuer and expiry all match.
   */
  async googleAuth(
    request: z.infer<typeof GoogleAuthValidation>,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<ApiResponse> {
    const clientId = envConfig.googleClientId;
    if (!clientId) {
      throw new AppError('Google sign-in is not configured on this server.', 400);
    }

    const profile = await this.verifyGoogleToken(request.credential, clientId);

    // Match on the Google subject id first, then fall back to the email so an
    // account created with a password can be signed into with the same address.
    let user = await this.userRepository.findOne({ where: { google_id: profile.sub } });
    if (!user) {
      user = await this.userRepository.findOne({ where: { email: profile.email } });
    }

    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedError('Your account has been deactivated');
      }
      let changed = false;
      if (!user.google_id) {
        user.google_id = profile.sub;
        changed = true;
      }
      if (profile.picture && user.avatar_url !== profile.picture) {
        user.avatar_url = profile.picture;
        changed = true;
      }
      if (changed) await this.userRepository.save(user);
    } else {
      user = this.userRepository.create({
        name: profile.name || profile.email.split('@')[0],
        email: profile.email,
        // The column is NOT NULL and this account never signs in with a
        // password, so it gets an unguessable one that is never shown anywhere.
        password: await CryptoHelper.hashPassword(crypto.randomBytes(32).toString('hex')),
        google_id: profile.sub,
        avatar_url: profile.picture || null,
        role: Role.USER,
        isActive: true,
      });
      await this.userRepository.save(user);
    }

    const accessToken = this.buildAccessTokenPayload(user);
    const refreshToken = await this.createRefreshToken(user.id, userAgent, ipAddress);
    await this.cookieService.setRefreshToken(refreshToken.token);

    const { password: _password, ...userWithoutPassword } = user;

    return {
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        token: accessToken.token,
        refreshToken: refreshToken.token,
        expireAt: accessToken.expireAt,
      },
    };
  }

  /**
   * Ask Google to validate the ID token and return what it says about the user.
   *
   * Google's tokeninfo endpoint does the signature check, which avoids fetching
   * and caching its rotating public keys here. It still has to be checked that
   * the token was issued for THIS application and has not expired — Google will
   * happily describe a valid token that belongs to somebody else's site.
   */
  private async verifyGoogleToken(
    credential: string,
    clientId: string,
  ): Promise<{ sub: string; email: string; name?: string; picture?: string }> {
    let payload: any;
    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) {
        throw new UnauthorizedError('Google rejected this sign-in. Please try again.');
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new AppError('Could not reach Google to verify the sign-in. Please try again.', 502);
    }

    const audience = String(payload?.aud || '');
    if (audience !== clientId) {
      throw new UnauthorizedError('This sign-in was not issued for Vector Brain.');
    }

    const issuer = String(payload?.iss || '');
    if (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') {
      throw new UnauthorizedError('Google rejected this sign-in. Please try again.');
    }

    const expiresAt = Number(payload?.exp || 0) * 1000;
    if (!expiresAt || expiresAt < Date.now()) {
      throw new UnauthorizedError('This sign-in expired. Please try again.');
    }

    const email = String(payload?.email || '').toLowerCase();
    // An unverified address could belong to anyone, and accepting it would let
    // a stranger take over a password account with the same email.
    const emailVerified = payload?.email_verified === true || payload?.email_verified === 'true';
    if (!email || !emailVerified) {
      throw new UnauthorizedError('This Google account has no verified email address.');
    }

    const sub = String(payload?.sub || '');
    if (!sub) {
      throw new UnauthorizedError('Google rejected this sign-in. Please try again.');
    }

    return {
      sub,
      email,
      name: payload?.name ? String(payload.name) : undefined,
      picture: payload?.picture ? String(payload.picture) : undefined,
    };
  }
}
