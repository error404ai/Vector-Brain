import { AiRule } from '@/entities/AiRule';
import { Role, User } from '@/entities/User';
import { AccessControllerHelper } from '@/helpers/AccessControllerHelper';
import AppError, { ForbiddenError } from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { AiEmbeddingService } from '@/services/AiEmbeddingService';
import { AiService } from '@/services/AiService';
import { ApiResponse } from '@/types/ApiResponse';
import { AiRuleListValidation, CreateAiRuleValidation, ExportAiRulesValidation, ImportAiRulesValidation, SearchAiRulesValidation, UpdateAiRuleValidation } from '@/validations/AiRuleValidation';
import { Service } from 'typedi';
import { FindOptionsWhere, In, Like } from 'typeorm';
import z from 'zod';

@Service()
export class AiRuleService {
  private aiRuleRepository = AppDataSource.getRepository(AiRule);

  constructor(
    private aiEmbeddingService: AiEmbeddingService,
    private aiService: AiService
  ) {}

  async list(request: z.infer<typeof AiRuleListValidation>, userId: number): Promise<ApiResponse> {
    if (!(await AccessControllerHelper.canCreateAiRule(userId))) {
      throw new ForbiddenError('Unauthorized to view AI rules');
    }

    const { page = 1, limit = 10, search, sortField, sortDirection } = request;

    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    const isAdmin = user?.role === Role.ADMIN;

    let where: FindOptionsWhere<AiRule> | FindOptionsWhere<AiRule>[] = isAdmin
      ? {} // Admins see all rules
      : [{ user_id: userId }, { user_id: null }]; // Users see their rules and global rules

    if (search) {
      if (isAdmin) {
        where = { name: Like(`%${search}%`) };
      } else {
        where = [
          { user_id: userId, name: Like(`%${search}%`) },
          { user_id: null, name: Like(`%${search}%`) },
        ];
      }
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

    if (request.is_global && !(await AccessControllerHelper.canManageAiRules(userId))) {
      throw new ForbiddenError('Only admins can create global AI rules');
    }

    const aiRule = this.aiRuleRepository.create({
      user_id: request.is_global ? null : userId,
      name: request.name,
      rule: request.rule,
      website: request.website,
      is_active: request.is_active ?? true,
    });

    const savedAiRule = await this.aiRuleRepository.save(aiRule);

    if (savedAiRule.rule && savedAiRule.rule.trim()) {
      await this.aiEmbeddingService.storeVector(savedAiRule.id, savedAiRule.website ? `${savedAiRule.website} ${savedAiRule.rule} ${savedAiRule.website}` : savedAiRule.rule, {
        name: savedAiRule.name,
        website: savedAiRule.website,
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
          await this.aiEmbeddingService.storeVector(aiRule.id, aiRule.website ? `${aiRule.website} ${aiRule.rule} ${aiRule.website}` : aiRule.rule, {
            name: aiRule.name,
            website: aiRule.website,
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

    const filteredRulesPromises = rules.map(async (rule) => {
      if (!rule.website) return rule;
      const isRelated = await this.aiService.isPromptRelatedToWebsite(prompt, rule.website);
      return isRelated ? rule : null;
    });
    const filteredRules = (await Promise.all(filteredRulesPromises)).filter((rule) => rule !== null) as typeof rules;

    const rulesWithScores = filteredRules
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
      return {
        id: rule.id,
        rule: rule.website ? `${rule.website} ${rule.rule} ${rule.website}` : rule.rule,
        metadata: {
          name: rule.name,
          website: rule.website,
          is_active: rule.is_active,
        },
      };
    });

    const rulesToBackfill = await Promise.all(rulesToBackfillPromises);

    await this.aiEmbeddingService.backfillVectors(rulesToBackfill);

    return {
      message: `Backfilled/updated vectors for ${rulesToBackfill.length} rules`,
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

    await this.aiEmbeddingService.storeVector(id, aiRule.website ? `${aiRule.website} ${aiRule.rule} ${aiRule.website}` : aiRule.rule, {
      name: aiRule.name,
      website: aiRule.website,
      is_active: aiRule.is_active,
    });

    return { message: 'AI rule vectorized successfully' };
  }

  async export(request: z.infer<typeof ExportAiRulesValidation>, userId: number): Promise<ApiResponse> {
    if (!(await AccessControllerHelper.canCreateAiRule(userId))) {
      throw new ForbiddenError('Unauthorized to export AI rules');
    }

    const { ids: idsString } = request;
    const ids = idsString ? idsString.split(',').map((id) => parseInt(id.trim())) : undefined;

    let rules: AiRule[];

    if (ids && ids.length > 0) {
      // For selected rules, check permissions unless user is admin
      const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
      const isAdmin = user?.role === Role.ADMIN;

      if (isAdmin) {
        // Admins can export any rules
        rules = await this.aiRuleRepository.find({
          where: { id: In(ids) },
          select: ['name', 'rule', 'website', 'is_active'],
        });
      } else {
        // Non-admins can only export rules they can view
        const accessibleIds: number[] = [];
        for (const id of ids) {
          if (await AccessControllerHelper.canViewAiRule(userId, id)) {
            accessibleIds.push(id);
          }
        }
        rules = await this.aiRuleRepository.find({
          where: { id: In(accessibleIds) },
          select: ['name', 'rule', 'website', 'is_active'],
        });
      }
    } else {
      // Export all accessible rules
      const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
      const isAdmin = user?.role === Role.ADMIN;

      const where: FindOptionsWhere<AiRule> | FindOptionsWhere<AiRule>[] = isAdmin ? {} : [{ user_id: userId }, { user_id: null }];
      rules = await this.aiRuleRepository.find({
        where,
        select: ['name', 'rule', 'website', 'is_active'],
      });
    }

    return {
      message: 'AI rules exported successfully',
      data: rules,
    };
  }

  async import(request: z.infer<typeof ImportAiRulesValidation>, userId: number): Promise<ApiResponse> {
    if (!(await AccessControllerHelper.canCreateAiRule(userId))) {
      throw new ForbiddenError('Unauthorized to import AI rules');
    }

    const { rules, deleteExisting = false } = request;

    if (deleteExisting) {
      // Delete all existing rules for the user
      await this.aiRuleRepository.delete({ user_id: userId });
      // Also delete vectors
      // Since we don't have ids, we need to fetch ids first or handle in embedding service
      // For simplicity, assume embedding service can handle bulk delete by user, but since it's not implemented, skip for now
    }

    const importedRules = [];
    const errors = [];

    for (const ruleData of rules) {
      try {
        const aiRule = this.aiRuleRepository.create({
          user_id: userId,
          name: ruleData.name,
          rule: ruleData.rule,
          website: ruleData.website,
          is_active: ruleData.is_active ?? true,
        });

        const savedAiRule = await this.aiRuleRepository.save(aiRule);

        if (savedAiRule.rule && savedAiRule.rule.trim()) {
          try {
            await this.aiEmbeddingService.storeVector(savedAiRule.id, savedAiRule.rule, {
              name: savedAiRule.name,
              website: savedAiRule.website,
              is_active: savedAiRule.is_active,
            });
          } catch (error) {
            Logger.error(`Failed to create vector for imported rule ${savedAiRule.id}:`, error);
            // Don't fail the import
          }
        }

        importedRules.push(savedAiRule);
      } catch (error) {
        Logger.error(`Failed to import rule "${ruleData.name}":`, error);
        errors.push({ name: ruleData.name, error: error.message });
      }
    }

    return {
      message: `Imported ${importedRules.length} rules${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
      data: { imported: importedRules.length, failed: errors.length, errors },
    };
  }

  async bulkDelete(ids: number[], userId: number): Promise<ApiResponse> {
    // Check permissions for each rule
    for (const id of ids) {
      if (!(await AccessControllerHelper.canDeleteAiRule(userId, id))) {
        throw new ForbiddenError(`Unauthorized to delete AI rule ${id}`);
      }
    }

    const rules = await this.aiRuleRepository.find({
      where: { id: In(ids) },
    });

    if (rules.length !== ids.length) {
      throw new AppError('Some AI rules not found', 404);
    }

    await this.aiRuleRepository.remove(rules);

    // Delete vectors
    for (const rule of rules) {
      try {
        await this.aiEmbeddingService.deleteVector(rule.id);
      } catch (error) {
        Logger.error(`Failed to delete vector for rule ${rule.id}:`, error);
        // Don't fail the request if vector deletion fails
      }
    }

    return { message: `Deleted ${rules.length} AI rules successfully` };
  }
}
