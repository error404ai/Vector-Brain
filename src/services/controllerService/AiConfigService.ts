import { AiConfig, AiConfigType, AiProvider } from '@/entities/AiConfig';
import AppError from '@/helpers/AppError';
import { CryptoHelper } from '@/helpers/CryptoHelper';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ApiResponse } from '@/types/ApiResponse';
import { CreateAiConfigValidation, TestAiConfigValidation, UpdateAiConfigValidation } from '@/validations/AiConfigValidation';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { Service } from 'typedi';
import { z } from 'zod';
import envConfig from '@/config/envConfig';

export interface AiConfigSafeView {
  id: number;
  user_id: number;
  provider: AiProvider;
  model: string;
  base_url: string | null;
  is_active: boolean;
  label: string | null;
  config_type: AiConfigType;
  has_api_key: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DecryptedAiConfig extends AiConfig {
  api_key: string;
}

@Service()
export class AiConfigService {
  private repo = AppDataSource.getRepository(AiConfig);

  private toSafeView(config: AiConfig): AiConfigSafeView {
    return {
      id: config.id,
      user_id: config.user_id,
      provider: config.provider,
      model: config.model,
      base_url: config.base_url,
      is_active: config.is_active,
      label: config.label,
      config_type: config.config_type,
      has_api_key: Boolean(config.encrypted_api_key),
      created_at: config.created_at,
      updated_at: config.updated_at,
    };
  }

  /**
   * Helper to derive the standard base URL for known providers if not explicitly set.
   */
  getDefaultBaseUrl(provider: AiProvider): string | undefined {
    switch (provider) {
      case AiProvider.OPENROUTER:
        return 'https://openrouter.ai/api/v1';
      case AiProvider.DEEPSEEK:
        return 'https://api.deepseek.com/v1';
      case AiProvider.GROQ:
        return 'https://api.groq.com/openai/v1';
      case AiProvider.GOOGLE:
        return 'https://generativelanguage.googleapis.com/v1beta/openai/';
      default:
        return undefined;
    }
  }

  /**
   * Instantiates a ChatOpenAI model instance for the given provider configuration.
   */
  createChatModel(config: { provider: AiProvider; model: string; api_key: string; base_url?: string | null; temperature?: number }): ChatOpenAI {
    const effectiveBaseUrl = config.base_url?.trim() || this.getDefaultBaseUrl(config.provider);
    const defaultHeaders: Record<string, string> = {};

    if (config.provider === AiProvider.OPENROUTER || effectiveBaseUrl?.includes('openrouter.ai')) {
      defaultHeaders['HTTP-Referer'] = 'https://vectorbrain.local';
      defaultHeaders['X-Title'] = 'Vector Brain';
    }

    return new ChatOpenAI({
      openAIApiKey: config.api_key,
      modelName: config.model,
      temperature: config.temperature ?? 0.1,
      configuration: effectiveBaseUrl
        ? {
            baseURL: effectiveBaseUrl,
            defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
          }
        : undefined,
    });
  }


  async list(userId: number): Promise<ApiResponse> {
    const configs = await this.repo.find({
      where: { user_id: userId },
      order: { is_active: 'DESC', updated_at: 'DESC' },
    });

    return {
      message: 'AI configurations retrieved successfully',
      data: configs.map((c) => this.toSafeView(c)),
    };
  }

  async getOne(id: number, userId: number): Promise<ApiResponse> {
    const config = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!config) throw new AppError('AI configuration not found', 404);

    return {
      message: 'AI configuration retrieved successfully',
      data: this.toSafeView(config),
    };
  }

  async create(dto: z.infer<typeof CreateAiConfigValidation>, userId: number): Promise<ApiResponse> {
    const willBeActive = dto.is_active ?? true;

    if (willBeActive) {
      await this.repo.update({ user_id: userId }, { is_active: false });
    }

    const encryptedKey = CryptoHelper.encryptAesGcm(dto.api_key);

    const config = this.repo.create({
      user_id: userId,
      provider: dto.provider,
      model: dto.model,
      encrypted_api_key: encryptedKey,
      base_url: dto.base_url?.trim() || null,
      is_active: willBeActive,
      label: dto.label?.trim() || null,
      config_type: dto.config_type || AiConfigType.VISION,
    });

    const saved = await this.repo.save(config);

    return {
      message: 'AI configuration created successfully',
      data: this.toSafeView(saved),
    };
  }

  async update(id: number, dto: z.infer<typeof UpdateAiConfigValidation>, userId: number): Promise<ApiResponse> {
    const config = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!config) throw new AppError('AI configuration not found', 404);

    if (dto.is_active === true) {
      await this.repo.update({ user_id: userId }, { is_active: false });
      config.is_active = true;
    } else if (dto.is_active === false) {
      config.is_active = false;
    }

    if (dto.provider) config.provider = dto.provider;
    if (dto.model) config.model = dto.model;
    if (dto.base_url !== undefined) config.base_url = dto.base_url?.trim() || null;
    if (dto.label !== undefined) config.label = dto.label?.trim() || null;
    if (dto.config_type) config.config_type = dto.config_type;
    if (dto.api_key) {
      config.encrypted_api_key = CryptoHelper.encryptAesGcm(dto.api_key);
    }

    const saved = await this.repo.save(config);

    return {
      message: 'AI configuration updated successfully',
      data: this.toSafeView(saved),
    };
  }

  async delete(id: number, userId: number): Promise<ApiResponse> {
    const config = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!config) throw new AppError('AI configuration not found', 404);

    await this.repo.remove(config);

    return { message: 'AI configuration deleted successfully' };
  }

  async setActive(id: number, userId: number): Promise<ApiResponse> {
    const config = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!config) throw new AppError('AI configuration not found', 404);

    await this.repo.update({ user_id: userId }, { is_active: false });
    config.is_active = true;
    const saved = await this.repo.save(config);

    return {
      message: 'AI configuration set as active',
      data: this.toSafeView(saved),
    };
  }

  /**
   * Tests connection with arbitrary credentials before saving.
   */
  async testCredentials(dto: z.infer<typeof TestAiConfigValidation>): Promise<ApiResponse> {
    const startTime = Date.now();
    try {
      const model = this.createChatModel({
        provider: dto.provider,
        model: dto.model,
        api_key: dto.api_key,
        base_url: dto.base_url,
        temperature: 0,
      });

      const response = await model.invoke([new HumanMessage('Ping. Reply with "pong".')]);
      const latencyMs = Date.now() - startTime;
      const reply = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

      return {
        message: 'Connection successful',
        data: {
          latencyMs,
          reply: reply.trim(),
        },
      };
    } catch (err: any) {
      Logger.error('[AiConfigService] Connection test failed:', err);
      throw new AppError(`Connection failed: ${err.message || 'Unknown provider error'}`, 400);
    }
  }

  /**
   * Tests an already saved configuration.
   */
  async testSaved(id: number, userId: number): Promise<ApiResponse> {
    const config = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!config) throw new AppError('AI configuration not found', 404);

    const decryptedKey = CryptoHelper.decryptAesGcm(config.encrypted_api_key);
    return this.testCredentials({
      provider: config.provider,
      model: config.model,
      api_key: decryptedKey,
      base_url: config.base_url,
    });
  }


  /**
   * Resolves one specific AI configuration owned by the user and decrypts its key.
   * Used when a task should run on a chosen provider instead of the active one,
   * which lets different devices run on different models at the same time.
   */
  async resolveConfigById(userId: number, configId: number): Promise<DecryptedAiConfig | null> {
    const config = await this.repo.findOne({ where: { id: configId, user_id: userId } });
    if (!config) return null;

    try {
      const apiKey = CryptoHelper.decryptAesGcm(config.encrypted_api_key);
      return Object.assign(config, { api_key: apiKey });
    } catch (err) {
      Logger.error(`[AiConfigService] Failed to decrypt API key for config ${configId}:`, err);
      return null;
    }
  }

  /**
   * Resolves the active AI configuration for a user, decrypts the API key,
   * and falls back to system .env if configured and no user config exists.
   */
  async resolveActiveConfig(userId?: number): Promise<DecryptedAiConfig | null> {
    if (userId) {
      const activeConfig = await this.repo.findOne({
        where: { user_id: userId, is_active: true },
        order: { updated_at: 'DESC' },
      });

      if (activeConfig) {
        try {
          const apiKey = CryptoHelper.decryptAesGcm(activeConfig.encrypted_api_key);
          return Object.assign(activeConfig, { api_key: apiKey });
        } catch (err) {
          Logger.error(`[AiConfigService] Failed to decrypt API key for user ${userId}:`, err);
        }
      }
    }

    // Optional fallback to system .env if present
    if (envConfig.androidAgentApiKey) {
      const fallback = new AiConfig();
      fallback.id = 0;
      fallback.user_id = userId || 0;
      fallback.provider = AiProvider.OPENAI;
      fallback.model = envConfig.androidAgentModel || 'gpt-4o-mini';
      fallback.base_url = null;
      fallback.is_active = true;
      fallback.label = 'System Default';
      fallback.config_type = AiConfigType.VISION;
      return Object.assign(fallback, { api_key: envConfig.androidAgentApiKey });
    }

    return null;
  }
}
