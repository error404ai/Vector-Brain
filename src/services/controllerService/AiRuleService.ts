import { AiRule } from '@/entities/AiRule';
import { AccessControllerHelper } from '@/helpers/AccessControllerHelper';
import AppError, { ForbiddenError } from '@/helpers/AppError';
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

  async list(request: z.infer<typeof AiRuleListValidation>, userId: number): Promise<ApiResponse> {
    if (!(await AccessControllerHelper.canCreateAiRule(userId))) {
      throw new ForbiddenError('Unauthorized to view AI rules');
    }

    const { page = 1, limit = 10, search, sortField, sortDirection } = request;

    const where: FindOptionsWhere<AiRule> = {};

    if (search) {
      where.name = Like(`%${search}%`);
    }

    const order: any = {};
    if (sortField) {
      order[sortField] = sortDirection || 'asc';
    } else {
      order.created_at = 'desc'; // Default sort by created_at descending
    }

    const [items, totalCount] = await this.aiRuleRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order,
    });

    // Hydrate to add vector_exist
    await (this.aiRuleRepository as any).hydrateEntities(items);

    const totalPages = Math.ceil(totalCount / limit);

    return {
      message: 'AI rules fetched successfully',
      data: items,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        pageSize: limit,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
    };
  }

  async details(id: number, userId: number): Promise<ApiResponse> {
    if (!(await AccessControllerHelper.canViewAiRule(userId, id))) {
      throw new ForbiddenError('Unauthorized to view this AI rule');
    }

    const aiRule = await this.aiRuleRepository.findOne({
      where: { id },
    });

    if (!aiRule) {
      throw new AppError('AI rule not found', 404);
    }

    return { message: 'AI rule details retrieved successfully', data: aiRule };
  }

  async create(request: z.infer<typeof CreateAiRuleValidation>, userId: number): Promise<ApiResponse> {
    if (!(await AccessControllerHelper.canCreateAiRule(userId))) {
      throw new ForbiddenError('Unauthorized to create AI rule');
    }

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

  async update(id: number, data: z.infer<typeof UpdateAiRuleValidation>, userId: number): Promise<ApiResponse> {
    if (!(await AccessControllerHelper.canUpdateAiRule(userId, id))) {
      throw new ForbiddenError('Unauthorized to update this AI rule');
    }

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

  async delete(id: number, userId: number): Promise<ApiResponse> {
    if (!(await AccessControllerHelper.canDeleteAiRule(userId, id))) {
      throw new ForbiddenError('Unauthorized to delete this AI rule');
    }

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

  async searchByPrompt(request: z.infer<typeof SearchAiRulesValidation>, userId: number): Promise<ApiResponse> {
    if (!(await AccessControllerHelper.canCreateAiRule(userId))) {
      throw new ForbiddenError('Unauthorized to search AI rules');
    }

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

  async backfillAllVectors(userId: number): Promise<ApiResponse> {
    if (!(await AccessControllerHelper.canManageAiRules(userId))) {
      throw new ForbiddenError('Unauthorized to manage AI rules');
    }

    const rules = await this.aiRuleRepository.find({
      where: { is_active: true },
    });

    // Filter rules that have content and are not already vectorized
    const rulesToCheck = rules.filter((rule) => rule.rule && rule.rule.trim());

    const rulesToBackfillPromises = rulesToCheck.map(async (rule) => {
      const exists = await this.aiEmbeddingService.vectorExists(rule.id);
      return exists
        ? null
        : {
            id: rule.id,
            rule: rule.rule,
            metadata: {
              name: rule.name,
              description: rule.description,
              is_active: rule.is_active,
            },
          };
    });

    const rulesToBackfillResults = await Promise.all(rulesToBackfillPromises);
    const rulesToBackfill = rulesToBackfillResults.filter((rule) => rule !== null);

    await this.aiEmbeddingService.backfillVectors(rulesToBackfill);

    return {
      message: `Backfilled vectors for ${rulesToBackfill.length} rules`,
      data: { count: rulesToBackfill.length },
    };
  }

  async vectorizeSingle(id: number): Promise<ApiResponse> {
    const aiRule = await this.aiRuleRepository.findOne({
      where: { id },
    });

    if (!aiRule) {
      throw new AppError('AI rule not found', 404);
    }

    if (!aiRule.rule || !aiRule.rule.trim()) {
      throw new AppError('AI rule has no content to vectorize', 400);
    }

    // Check if already vectorized
    const exists = await this.aiEmbeddingService.vectorExists(id);
    if (exists) {
      throw new AppError('AI rule is already vectorized', 400);
    }

    await this.aiEmbeddingService.storeVector(id, aiRule.rule, {
      name: aiRule.name,
      description: aiRule.description,
      is_active: aiRule.is_active,
    });

    return { message: 'AI rule vectorized successfully' };
  }
}
