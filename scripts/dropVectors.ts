// Script to drop vector database collection
import { AiEmbeddingService } from '../src/services/AiEmbeddingService';

async function dropVectors() {
  console.log('Dropping vector database collection...');

  try {
    const embeddingService = new AiEmbeddingService();
    await embeddingService.initialize();
    await embeddingService.dropCollection();

    console.log('Vector database collection dropped successfully!');
  } catch (error) {
    console.error('Failed to drop vector database collection:', error);
    process.exit(1);
  }
}

dropVectors();
