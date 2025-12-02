import { User } from '@/entities/User';
import AppError from '@/helpers/AppError';
import { CryptoHelper } from '@/helpers/CryptoHelper';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { CreateUserValidation, UpdateUserValidation, UserListValidation } from '@/validations/UserValidation';
import { Service } from 'typedi';
import z from 'zod';

@Service()
export class UserService {
  private userRepository = AppDataSource.getRepository(User);

  async list(request: z.infer<typeof UserListValidation>): Promise<ApiResponse> {
    const { page = 1, limit = 10, search } = request;
    const skip = (page - 1) * limit;

    const queryBuilder = this.userRepository.createQueryBuilder('user').where('user.deletedAt IS NULL');

    if (search) {
      queryBuilder.andWhere('(user.name LIKE :search OR user.email LIKE :search)', { search: `%${search}%` });
    }

    const [users, total] = await queryBuilder.skip(skip).take(limit).getManyAndCount();

    return {
      message: 'Users retrieved successfully',
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async details(id: number): Promise<ApiResponse> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    return {
      message: 'User details retrieved successfully',
      data: user,
    };
  }

  async create(request: z.infer<typeof CreateUserValidation>): Promise<ApiResponse> {
    // Check if email already exists
    const existingUser = await this.userRepository.findOne({
      where: { email: request.email },
    });

    if (existingUser) {
      throw new AppError('Email already exists', 400);
    }

    // Hash the password before saving
    const hashedPassword = CryptoHelper.generateHash(request.password);

    const user = this.userRepository.create({
      ...request,
      password: hashedPassword,
    });
    await this.userRepository.save(user);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return {
      message: 'User created successfully',
      data: userWithoutPassword,
    };
  }

  async update(id: number, data: z.infer<typeof UpdateUserValidation>): Promise<ApiResponse> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Check if email is being changed and if it already exists
    if (data.email && data.email !== user.email) {
      const existingUser = await this.userRepository.findOne({
        where: { email: data.email },
      });

      if (existingUser) {
        throw new AppError('Email already exists', 400);
      }
    }

    // Hash password if it's being updated
    if (data.password) {
      data.password = CryptoHelper.generateHash(data.password);
    }

    Object.assign(user, data);
    await this.userRepository.save(user);

    return {
      message: 'User updated successfully',
      data: user,
    };
  }

  async delete(id: number): Promise<ApiResponse> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    await this.userRepository.softDelete(id);

    return {
      message: 'User deleted successfully',
    };
  }
}
