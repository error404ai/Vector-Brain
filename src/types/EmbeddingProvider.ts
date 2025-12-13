export interface IEmbeddingProvider {
  embedText(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  getProviderName(): string;
}
export interface EmbeddingProviderConfig {
  provider: 'openai' | 'deepseek' | 'custom';
  apiKey: string;
  model?: string;
  baseUrl?: string;
  dimensions?: number;
}
export interface VectorSearchResult {
  id: number;
  score: number;
  payload?: Record<string, unknown>;
}
