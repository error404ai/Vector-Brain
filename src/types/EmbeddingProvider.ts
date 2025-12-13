/**
 * Embedding Provider Interface
 *
 * This interface provides an abstraction layer for embedding providers,
 * allowing easy switching between different models (OpenAI, DeepSeek, etc.)
 * without changing the core logic.
 */

export interface IEmbeddingProvider {
  /**
   * Generate an embedding vector for a single text input
   * @param text - The text to embed
   * @returns A promise that resolves to an array of numbers (the embedding vector)
   */
  embedText(text: string): Promise<number[]>;

  /**
   * Generate embedding vectors for multiple text inputs
   * @param texts - Array of texts to embed
   * @returns A promise that resolves to an array of embedding vectors
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Get the dimension of the embedding vectors produced by this provider
   * @returns The number of dimensions in the embedding vectors
   */
  getDimensions(): number;

  /**
   * Get the name of the provider for logging/debugging
   * @returns The provider name
   */
  getProviderName(): string;
}

/**
 * Configuration options for embedding providers
 */
export interface EmbeddingProviderConfig {
  provider: 'openai' | 'deepseek' | 'custom';
  apiKey: string;
  model?: string;
  baseUrl?: string;
  dimensions?: number;
}

/**
 * Result from a vector similarity search
 */
export interface VectorSearchResult {
  id: number;
  score: number;
  payload?: Record<string, unknown>;
}
