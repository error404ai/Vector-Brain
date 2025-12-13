import { AiRule } from '@/entities/AiRule';
import AppError from '@/helpers/AppError';
import paginate from '@/helpers/paginationHelper';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { AiEmbeddingService } from '@/services/AiEmbeddingService';
import { ApiResponse } from '@/types/ApiResponse';
import { AiRuleListValidation, CreateAiRuleValidation, SearchAiRulesValidation, UpdateAiRuleValidation } from '@/validations/AiRuleValidation';
import { Service } from 'typedi';
import { FindOptionsWhere, In, Like } from 'typeorm';
import z from 'zod';

@Service()
export class AiRuleService {
  private aiRuleRepository = AppDataSource.getRepository(AiRule);

  constructor(private aiEmbeddingService: AiEmbeddingService) {}

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
      rule: request.rule,
      is_active: request.is_active ?? true,
    });

    const savedAiRule = await this.aiRuleRepository.save(aiRule);

    if (savedAiRule.rule && savedAiRule.rule.trim()) {
      await this.aiEmbeddingService.storeVector(savedAiRule.id, savedAiRule.rule, {
        name: savedAiRule.name,
        description: savedAiRule.description,
        is_active: savedAiRule.is_active,
      });
    }

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

    if (data.rule !== undefined) {
      try {
        if (aiRule.rule && aiRule.rule.trim()) {
          await this.aiEmbeddingService.storeVector(aiRule.id, aiRule.rule, {
            name: aiRule.name,
            description: aiRule.description,
            is_active: aiRule.is_active,
          });
        } else {
          // Remove vector if rule text is cleared
          await this.aiEmbeddingService.deleteVector(aiRule.id);
        }
      } catch (error) {
        Logger.error(`Failed to update vector for rule ${id}:`, error);
        // Don't fail the request if vector update fails
      }
    }

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

    try {
      await this.aiEmbeddingService.deleteVector(id);
    } catch (error) {
      Logger.error(`Failed to delete vector for rule ${id}:`, error);
      // Don't fail the request if vector deletion fails
    }

    return { message: 'AI rule deleted successfully' };
  }

  async searchByPrompt(request: z.infer<typeof SearchAiRulesValidation>): Promise<ApiResponse> {
    const { prompt, limit = 10 } = request;

    const searchResults = await this.aiEmbeddingService.searchSimilar(prompt, limit, { is_active: true });

    if (searchResults.length === 0) {
      return { message: 'No matching rules found', data: [] };
    }

    const ruleIds = searchResults.map((result) => result.id);

    const rules = await this.aiRuleRepository.find({
      where: { id: In(ruleIds) },
    });

    const rulesWithScores = rules
      .map((rule) => {
        const searchResult = searchResults.find((r) => r.id === rule.id);
        return {
          ...rule,
          similarity_score: searchResult?.score || 0,
        };
      })
      .sort((a, b) => b.similarity_score - a.similarity_score);

    return {
      message: 'Rules retrieved successfully',
      data: rulesWithScores,
    };
  }

  async backfillAllVectors(): Promise<ApiResponse> {
    const rules = await this.aiRuleRepository.find({
      where: { is_active: true },
    });

    const rulesToBackfill = rules
      .filter((rule) => rule.rule && rule.rule.trim())
      .map((rule) => ({
        id: rule.id,
        rule: rule.rule,
        metadata: {
          name: rule.name,
          description: rule.description,
          is_active: rule.is_active,
        },
      }));

    await this.aiEmbeddingService.backfillVectors(rulesToBackfill);

    return {
      message: `Backfilled vectors for ${rulesToBackfill.length} rules`,
      data: { count: rulesToBackfill.length },
    };
  }
}
