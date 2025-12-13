import envConfig from '@/config/envConfig';
import Logger from '@/logger/index';
import { IEmbeddingProvider, VectorSearchResult } from '@/types/EmbeddingProvider';
import { QdrantClient } from '@qdrant/js-client-rest';
import { Service } from 'typedi';
import { createEmbeddingProvider } from './embedding/EmbeddingProviders';

@Service()
export class AiEmbeddingService {
  private qdrantClient: QdrantClient;
  private embeddingProvider: IEmbeddingProvider | null = null;
  private collectionName: string;
  private isInitialized: boolean = false;

  constructor() {
    this.qdrantClient = new QdrantClient({
      url: envConfig.qdrantUrl,
      ...(envConfig.qdrantApiKey && { apiKey: envConfig.qdrantApiKey }),
    });

    this.collectionName = envConfig.qdrantCollectionName || 'ai_rules';
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      if (envConfig.embeddingApiKey) {
        this.embeddingProvider = await createEmbeddingProvider({
          provider: envConfig.embeddingProvider || 'openai',
          apiKey: envConfig.embeddingApiKey,
          model: envConfig.embeddingModel,
          baseUrl: envConfig.embeddingBaseUrl,
          dimensions: envConfig.embeddingDimensions,
        });
        Logger.info(`Embedding provider initialized: ${this.embeddingProvider.getProviderName()}`);
      } else {
        Logger.warn('No embedding API key configured. Vector operations will be skipped.');
      }

      await this.ensureCollectionExists();
      this.isInitialized = true;
      Logger.info('AiEmbeddingService initialized successfully');
    } catch (error) {
      Logger.error('Failed to initialize AiEmbeddingService:', error);
      throw error;
    }
  }

  private async ensureCollectionExists(): Promise<void> {
    try {
      const collections = await this.qdrantClient.getCollections();
      const exists = collections.collections.some((c) => c.name === this.collectionName);

      if (!exists) {
        const dimensions = this.embeddingProvider?.getDimensions() || envConfig.embeddingDimensions || 1536;

        await this.qdrantClient.createCollection(this.collectionName, {
          vectors: {
            size: dimensions,
            distance: 'Cosine',
          },
        });

        await this.qdrantClient.createPayloadIndex(this.collectionName, {
          field_name: 'rule_id',
          field_schema: 'integer',
        });

        await this.qdrantClient.createPayloadIndex(this.collectionName, {
          field_name: 'is_active',
          field_schema: 'bool',
        });

        Logger.info(`Created Qdrant collection: ${this.collectionName} with ${dimensions} dimensions`);
      } else {
        Logger.info(`Qdrant collection already exists: ${this.collectionName}`);
      }
    } catch (error) {
      Logger.error('Failed to ensure Qdrant collection exists:', error);
      throw error;
    }
  }

  isConfigured(): boolean {
    return this.isInitialized && this.embeddingProvider !== null;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingProvider) {
      throw new Error('Embedding provider not configured');
    }
    return this.embeddingProvider.embedText(text);
  }

  async storeVector(ruleId: number, text: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.isConfigured()) {
      Logger.warn('Embedding service not configured, skipping vector storage');
      return;
    }

    try {
      const vector = await this.generateEmbedding(text);

      await this.qdrantClient.upsert(this.collectionName, {
        points: [
          {
            id: ruleId,
            vector,
            payload: {
              rule_id: ruleId,
              ...metadata,
            },
          },
        ],
      });

      Logger.info(`Stored vector for rule ID: ${ruleId}`);
    } catch (error) {
      Logger.error(`Failed to store vector for rule ID ${ruleId}:`, error);
      throw error;
    }
  }

  async deleteVector(ruleId: number): Promise<void> {
    if (!this.isConfigured()) {
      Logger.warn('Embedding service not configured, skipping vector deletion');
      return;
    }

    try {
      await this.qdrantClient.delete(this.collectionName, {
        points: [ruleId],
      });

      Logger.info(`Deleted vector for rule ID: ${ruleId}`);
    } catch (error) {
      Logger.error(`Failed to delete vector for rule ID ${ruleId}:`, error);
      throw error;
    }
  }

  async searchSimilar(prompt: string, limit: number = 10, filter?: { is_active?: boolean }): Promise<VectorSearchResult[]> {
    if (!this.isConfigured()) {
      Logger.warn('Embedding service not configured, returning empty results');
      return [];
    }

    try {
      const promptVector = await this.generateEmbedding(prompt);

      const qdrantFilter = filter
        ? {
            must: Object.entries(filter)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => ({
                key,
                match: { value },
              })),
          }
        : undefined;

      const results = await this.qdrantClient.search(this.collectionName, {
        vector: promptVector,
        limit,
        with_payload: true,
        ...(qdrantFilter && qdrantFilter.must.length > 0 && { filter: qdrantFilter }),
      });

      return results.map((result) => ({
        id: result.payload?.rule_id as number,
        score: result.score,
        payload: result.payload as Record<string, unknown>,
      }));
    } catch (error) {
      Logger.error('Failed to search similar vectors:', error);
      throw error;
    }
  }

  async vectorExists(ruleId: number): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    try {
      const result = await this.qdrantClient.retrieve(this.collectionName, {
        ids: [ruleId],
        with_payload: false,
        with_vector: false,
      });
      return result.length > 0;
    } catch (error) {
      Logger.error(`Failed to check vector existence for rule ID ${ruleId}:`, error);
      return false;
    }
  }

  async backfillVectors(rules: Array<{ id: number; rule: string; metadata?: Record<string, unknown> }>): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Embedding service not configured');
    }

    Logger.info(`Starting backfill for ${rules.length} rules`);

    for (const ruleData of rules) {
      if (ruleData.rule && ruleData.rule.trim()) {
        try {
          await this.storeVector(ruleData.id, ruleData.rule, ruleData.metadata);
        } catch (error) {
          Logger.error(`Failed to backfill vector for rule ID ${ruleData.id}:`, error);
        }
      }
    }

    Logger.info('Backfill completed');
  }
}
