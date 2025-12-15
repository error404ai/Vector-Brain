import { User } from '@/entities/User';
import AppError from '@/helpers/AppError';
import { CryptoHelper } from '@/helpers/CryptoHelper';
import paginate from '@/helpers/paginationHelper';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { CreateUserValidation, UpdateUserValidation, UserListValidation } from '@/validations/UserValidation';
import { Service } from 'typedi';
import { FindManyOptions, FindOptionsWhere, IsNull, Like } from 'typeorm';
import z from 'zod';

@Service()
export class UserService {
  private userRepository = AppDataSource.getRepository(User);

  async list(request: z.infer<typeof UserListValidation>): Promise<ApiResponse> {
    const { page = 1, limit = 10, search, sortField, sortDirection } = request;

    const where: FindOptionsWhere<User> | FindOptionsWhere<User>[] = { deletedAt: IsNull() };

    if (search) {
      where.name = Like(`%${search}%`);
    }

    const findOptions: FindManyOptions<User> = {
      where,
    };

    // Default sort by created_at descending if no sort specified
    if (sortField) {
      findOptions.order = {
        [sortField]: sortDirection || 'asc',
      };
    } else {
      findOptions.order = {
        created_at: 'desc',
      };
    }

    return await paginate(this.userRepository, {
      page,
      limit,
      findOptions,
    });
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
    const existingUser = await this.userRepository.findOne({
      where: { email: request.email },
    });

    if (existingUser) {
      throw new AppError('Email already exists', 400);
    }

    const hashedPassword = CryptoHelper.generateHash(request.password);

    const user = this.userRepository.create({
      ...request,
      password: hashedPassword,
    });
    await this.userRepository.save(user);

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

    if (data.email && data.email !== user.email) {
      const existingUser = await this.userRepository.findOne({
        where: { email: data.email },
      });

      if (existingUser) {
        throw new AppError('Email already exists', 400);
      }
    }

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
