import envConfig from '@/config/envConfig';
import Logger from '@/logger/index';
import { IEmbeddingProvider, VectorSearchResult } from '@/types/EmbeddingProvider';
import { QdrantClient } from '@qdrant/js-client-rest';
import { Service } from 'typedi';
import { createEmbeddingProvider } from './embedding/EmbeddingProviders';

/**
 * AI Embedding Service
 *
 * This service handles:
 * 1. Generating embeddings using configurable providers (OpenAI, DeepSeek, etc.)
 * 2. Storing and retrieving vectors from Qdrant
 * 3. Performing similarity searches
 *
 * The embedding provider can be easily switched via environment configuration.
 */
@Service()
export class AiEmbeddingService {
  private qdrantClient: QdrantClient;
  private embeddingProvider: IEmbeddingProvider | null = null;
  private collectionName: string;
  private isInitialized: boolean = false;

  constructor() {
    // Initialize Qdrant client
    this.qdrantClient = new QdrantClient({
      url: envConfig.qdrantUrl,
      ...(envConfig.qdrantApiKey && { apiKey: envConfig.qdrantApiKey }),
    });

    this.collectionName = envConfig.qdrantCollectionName || 'ai_rules';
  }

  /**
   * Initialize the embedding provider and Qdrant collection
   * Call this on application startup
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize embedding provider if API key is configured
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

      // Initialize Qdrant collection
      await this.ensureCollectionExists();
      this.isInitialized = true;
      Logger.info('AiEmbeddingService initialized successfully');
    } catch (error) {
      Logger.error('Failed to initialize AiEmbeddingService:', error);
      throw error;
    }
  }

  /**
   * Ensure the Qdrant collection exists, create it if not
   */
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

        // Create payload index for faster filtering
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

  /**
   * Check if the service is properly configured for vector operations
   */
  isConfigured(): boolean {
    return this.isInitialized && this.embeddingProvider !== null;
  }

  /**
   * Generate embedding for a text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingProvider) {
      throw new Error('Embedding provider not configured');
    }
    return this.embeddingProvider.embedText(text);
  }

  /**
   * Store a vector in Qdrant for an AI rule
   *
   * @param ruleId - The ID of the AI rule in the database
   * @param text - The text to embed (typically the rule content)
   * @param metadata - Additional metadata to store with the vector
   */
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

  /**
   * Delete a vector from Qdrant
   *
   * @param ruleId - The ID of the AI rule to delete
   */
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

  /**
   * Search for similar rules based on a prompt
   *
   * @param prompt - The search prompt
   * @param limit - Maximum number of results to return
   * @param filter - Optional filter conditions
   * @returns Array of search results with rule IDs and similarity scores
   */
  async searchSimilar(prompt: string, limit: number = 10, filter?: { is_active?: boolean }): Promise<VectorSearchResult[]> {
    if (!this.isConfigured()) {
      Logger.warn('Embedding service not configured, returning empty results');
      return [];
    }

    try {
      const promptVector = await this.generateEmbedding(prompt);

      // Build filter if provided
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

  /**
   * Backfill vectors for existing rules
   * Useful for migrating existing data
   *
   * @param rules - Array of rules with id, rule text, and optional metadata
   */
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
