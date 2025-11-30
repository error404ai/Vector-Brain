import { User } from '@/entities/User';
import { UnauthorizedError } from '@/helpers/AppError';
import { CryptoHelper } from '@/helpers/CryptoHelper';
import { JwtHelper } from '@/helpers/JwtHelper';
import { AppDataSource } from '@/loaders/database';
import { LoginDto } from '@/validations/AuthValidation';
import { Service } from 'typedi';

@Service()
export class AuthService {
  private userRepository = AppDataSource.getRepository(User);

  async login(data: LoginDto) {
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

    // Generate JWT token
    const token = JwtHelper.generateToken({
      userId: user.id,
      email: user.email,
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return {
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        token,
      },
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
