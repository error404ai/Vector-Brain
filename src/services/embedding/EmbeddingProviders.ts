import { EmbeddingProviderConfig, IEmbeddingProvider } from '@/types/EmbeddingProvider';
import { Embeddings } from '@langchain/core/embeddings';

export abstract class BaseLangChainProvider implements IEmbeddingProvider {
  protected embeddings: Embeddings;
  protected dimensions: number;
  protected providerName: string;

  constructor(embeddings: Embeddings, dimensions: number, providerName: string) {
    this.embeddings = embeddings;
    this.dimensions = dimensions;
    this.providerName = providerName;
  }

  async embedText(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }
    return this.embeddings.embedQuery(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      throw new Error('Texts array cannot be empty');
    }
    return this.embeddings.embedDocuments(texts);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getProviderName(): string {
    return this.providerName;
  }
}

export async function createEmbeddingProvider(config: EmbeddingProviderConfig): Promise<IEmbeddingProvider> {
  switch (config.provider) {
    case 'openai':
      return createOpenAIProvider(config);
    case 'deepseek':
      return createDeepSeekProvider(config);
    case 'custom':
      return createCustomProvider(config);
    default:
      throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }
}

async function createOpenAIProvider(config: EmbeddingProviderConfig): Promise<IEmbeddingProvider> {
  const { OpenAIEmbeddings } = await import('@langchain/openai');

  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: config.apiKey,
    modelName: config.model || 'text-embedding-ada-002',
    ...(config.dimensions && { dimensions: config.dimensions }),
  });

  let dimensions = config.dimensions || 1536;
  if (config.model === 'text-embedding-3-small') {
    dimensions = config.dimensions || 1536;
  } else if (config.model === 'text-embedding-3-large') {
    dimensions = config.dimensions || 3072;
  }

  return new (class extends BaseLangChainProvider {
    constructor() {
      super(embeddings, dimensions, 'openai');
    }
  })();
}

async function createDeepSeekProvider(config: EmbeddingProviderConfig): Promise<IEmbeddingProvider> {
  const { OpenAIEmbeddings } = await import('@langchain/openai');

  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: config.apiKey,
    modelName: config.model || 'deepseek-chat',
    configuration: {
      baseURL: config.baseUrl || 'https://api.deepseek.com/v1',
    },
  });

  const dimensions = config.dimensions || 768;

  return new (class extends BaseLangChainProvider {
    constructor() {
      super(embeddings, dimensions, 'deepseek');
    }
  })();
}

async function createCustomProvider(config: EmbeddingProviderConfig): Promise<IEmbeddingProvider> {
  if (!config.baseUrl) {
    throw new Error('Custom provider requires a baseUrl');
  }

  const { OpenAIEmbeddings } = await import('@langchain/openai');

  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: config.apiKey,
    modelName: config.model || 'default',
    configuration: {
      baseURL: config.baseUrl,
    },
  });

  const dimensions = config.dimensions || 1536;

  return new (class extends BaseLangChainProvider {
    constructor() {
      super(embeddings, dimensions, 'custom');
    }
  })();
}
