import { RefreshToken } from '@/entities/RefreshToken';
import { Role, User } from '@/entities/User';
import AppError, { UnauthorizedError } from '@/helpers/AppError';
import { CryptoHelper } from '@/helpers/CryptoHelper';
import { JwtHelper } from '@/helpers/JwtHelper';
import { AppDataSource } from '@/loaders/database';
import { CookieService } from '@/services/auth/CookieService';
import { ApiResponse } from '@/types/ApiResponse';
import { LoginValidation, RefreshTokenValidation, SignupValidation } from '@/validations/AuthValidation';
import crypto from 'crypto';
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

  private async createRefreshToken(userId: number, userAgent?: string, ipAddress?: string): Promise<RefreshToken> {
    const token = this.generateRefreshToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const refreshToken = this.refreshTokenRepository.create({
      token,
      userId,
      expiresAt,
      userAgent,
      ipAddress,
      revoked: false,
    });

    return this.refreshTokenRepository.save(refreshToken);
  }

  private buildAccessTokenPayload(user: User) {
    const token = JwtHelper.generateToken(
      {
        userId: user.id,
        email: user.email,
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

    const hashedPassword = CryptoHelper.generateHash(request.password);
    if (user.password !== hashedPassword) {
      throw new UnauthorizedError('Invalid email or password');
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

    const refreshToken = await this.refreshTokenRepository.findOne({
      where: { token: refreshTokenString, revoked: false },
    });

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

    await this.cookieService.setRefreshToken(refreshToken.token);

    return {
      status: 'success',
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken.token,
        expire_at: newAccessToken.expireAt,
      },
    };
  }

  async logout(userId?: number, refreshTokenString?: string): Promise<ApiResponse> {
    let tokenToRevoke = refreshTokenString;

    if (!tokenToRevoke) {
      tokenToRevoke = (await this.cookieService.getRefreshToken()) ?? undefined;
    }

    if (tokenToRevoke) {
      await this.refreshTokenRepository.update({ token: tokenToRevoke }, { revoked: true });
    } else if (userId) {
      await this.refreshTokenRepository.update({ userId }, { revoked: true });
    }

    await this.cookieService.clearRefreshToken();

    return {
      message: 'Logged out successfully',
    };
  }

  async getProfile(userId: number): Promise<ApiResponse> {
    const user = await this.userRepository.findOne({
      where: { id: userId, deletedAt: undefined },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    return {
      message: 'Profile retrieved successfully',
      data: user,
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

    const hashedPassword = CryptoHelper.generateHash(password!);

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
}
