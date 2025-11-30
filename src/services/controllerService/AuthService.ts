import { RefreshToken } from '@/entities/RefreshToken';
import { User } from '@/entities/User';
import { UnauthorizedError } from '@/helpers/AppError';
import { CryptoHelper } from '@/helpers/CryptoHelper';
import { JwtHelper } from '@/helpers/JwtHelper';
import { AppDataSource } from '@/loaders/database';
import { LoginDto } from '@/validations/AuthValidation';
import crypto from 'crypto';
import { Service } from 'typedi';

@Service()
export class AuthService {
  private userRepository = AppDataSource.getRepository(User);
  private refreshTokenRepository = AppDataSource.getRepository(RefreshToken);

  // Generate a secure refresh token
  private generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  // Create and save refresh token to database
  private async createRefreshToken(userId: number, userAgent?: string, ipAddress?: string): Promise<RefreshToken> {
    const token = this.generateRefreshToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiry

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

  async login(data: LoginDto, userAgent?: string, ipAddress?: string) {
    // Find user by email including the password field
    const user = await this.userRepository.createQueryBuilder('user').addSelect('user.password').where('user.email = :email', { email: data.email }).andWhere('user.deletedAt IS NULL').getOne();

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Your account has been deactivated');
    }

    // Verify password
    const hashedPassword = CryptoHelper.generateHash(data.password);
    if (user.password !== hashedPassword) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Generate JWT access token (short-lived)
    const accessToken = JwtHelper.generateToken(
      {
        userId: user.id,
        email: user.email,
      },
      '1h' // 1 hour expiry
    );

    // Generate refresh token (long-lived)
    const refreshToken = await this.createRefreshToken(user.id, userAgent, ipAddress);

    // Calculate expire time
    const expireAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return {
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        token: accessToken,
        refreshToken: refreshToken.token,
        expireAt,
      },
    };
  }

  async refreshAccessToken(refreshTokenString: string) {
    // Find the refresh token
    const refreshToken = await this.refreshTokenRepository.findOne({
      where: { token: refreshTokenString, revoked: false },
    });

    if (!refreshToken) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Check if token has expired
    if (new Date() > refreshToken.expiresAt) {
      // Revoke the expired token
      refreshToken.revoked = true;
      await this.refreshTokenRepository.save(refreshToken);
      throw new UnauthorizedError('Refresh token has expired');
    }

    // Find the user
    const user = await this.userRepository.findOne({
      where: { id: refreshToken.userId, deletedAt: undefined },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('User not found or inactive');
    }

    // Generate new access token
    const newAccessToken = JwtHelper.generateToken(
      {
        userId: user.id,
        email: user.email,
      },
      '1h'
    );

    const expireAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    return {
      status: 'success',
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        expire_at: expireAt,
      },
    };
  }

  async logout(userId: number, refreshTokenString?: string) {
    if (refreshTokenString) {
      // Revoke specific refresh token
      await this.refreshTokenRepository.update({ token: refreshTokenString, userId }, { revoked: true });
    } else {
      // Revoke all refresh tokens for this user
      await this.refreshTokenRepository.update({ userId }, { revoked: true });
    }

    return {
      message: 'Logged out successfully',
    };
  }

  async getProfile(userId: number) {
    const user = await this.userRepository.findOne({
      where: { id: userId, deletedAt: undefined },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    return {
      data: user,
    };
  }
}
