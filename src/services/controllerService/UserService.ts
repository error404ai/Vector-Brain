import { User } from '@/entities/User';
import AppError from '@/helpers/AppError';
import { CryptoHelper } from '@/helpers/CryptoHelper';
import { AppDataSource } from '@/loaders/database';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from '@/validations/UserValidation';
import { Service } from 'typedi';

@Service()
export class UserService {
  private userRepository = AppDataSource.getRepository(User);

  async findAll(query: UserQueryDto) {
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;

    const queryBuilder = this.userRepository.createQueryBuilder('user').where('user.deletedAt IS NULL');

    if (search) {
      queryBuilder.andWhere('(user.name LIKE :search OR user.email LIKE :search)', { search: `%${search}%` });
    }

    const [users, total] = await queryBuilder.skip(skip).take(limit).getManyAndCount();

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    return { data: user };
  }

  async create(data: CreateUserDto) {
    // Check if email already exists
    const existingUser = await this.userRepository.findOne({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new AppError('Email already exists', 400);
    }

    // Hash the password before saving
    const hashedPassword = CryptoHelper.generateHash(data.password);

    const user = this.userRepository.create({
      ...data,
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

  async update(id: number, data: UpdateUserDto) {
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

  async delete(id: number) {
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
