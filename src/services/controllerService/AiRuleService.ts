import { AiRule } from '@/entities/AiRule';
import AppError from '@/helpers/AppError';
import paginate from '@/helpers/paginationHelper';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { AiRuleListValidation, CreateAiRuleValidation, UpdateAiRuleValidation } from '@/validations/AiRuleValidation';
import { Service } from 'typedi';
import { FindOptionsWhere, Like } from 'typeorm';
import z from 'zod';

@Service()
export class AiRuleService {
  private aiRuleRepository = AppDataSource.getRepository(AiRule);

  async list(request: z.infer<typeof AiRuleListValidation>): Promise<ApiResponse> {
    const { page = 1, limit = 10, search } = request;

    const where: FindOptionsWhere<AiRule> = {};

    if (search) {
      where.name = Like(`%${search}%`);
    }

    return await paginate(this.aiRuleRepository, {
      page,
      limit,
      findOptions: {
        where,
      },
    });
  }

  async details(id: number): Promise<ApiResponse> {
    const aiRule = await this.aiRuleRepository.findOne({
      where: { id },
    });

    if (!aiRule) {
      throw new AppError('AI rule not found', 404);
    }

    return { message: 'AI rule details retrieved successfully', data: aiRule };
  }

  async create(request: z.infer<typeof CreateAiRuleValidation>, userId: number): Promise<ApiResponse> {
    const aiRule = this.aiRuleRepository.create({
      user_id: userId,
      name: request.name,
      description: request.description,
      conditions: request.conditions,
      is_active: request.is_active ?? true,
    });

    const savedAiRule = await this.aiRuleRepository.save(aiRule);

    return { message: 'AI rule created successfully', data: savedAiRule };
  }

  async update(id: number, data: z.infer<typeof UpdateAiRuleValidation>): Promise<ApiResponse> {
    const aiRule = await this.aiRuleRepository.findOne({
      where: { id },
    });

    if (!aiRule) {
      throw new AppError('AI rule not found', 404);
    }

    Object.assign(aiRule, data);
    await this.aiRuleRepository.save(aiRule);

    return { message: 'AI rule updated successfully', data: aiRule };
  }

  async delete(id: number): Promise<ApiResponse> {
    const aiRule = await this.aiRuleRepository.findOne({
      where: { id },
    });

    if (!aiRule) {
      throw new AppError('AI rule not found', 404);
    }

    await this.aiRuleRepository.remove(aiRule);

    return { message: 'AI rule deleted successfully' };
  }
}
