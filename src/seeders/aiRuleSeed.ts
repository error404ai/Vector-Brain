import { AiRule } from '@/entities/AiRule';
import { AiEmbeddingService } from '@/services/AiEmbeddingService';
import { DataSource } from 'typeorm';

export const aiRuleSeed = async (connection: DataSource) => {
  // Demo AI rule data
  const aiRuleData: Partial<AiRule>[] = [
    {
      user_id: 1, // Assuming admin user has id 1
      name: 'Greeting Rule',
      description: 'Rule for handling greeting messages',
      rule: 'If the user says hello or hi, respond with a friendly greeting and ask how you can help.',
      is_active: true,
    },
    {
      user_id: 1,
      name: 'Farewell Rule',
      description: 'Rule for handling goodbye messages',
      rule: 'If the user says goodbye or bye, respond with a polite farewell and offer assistance in the future.',
      is_active: true,
    },
    {
      user_id: 1,
      name: 'Question Handling',
      description: 'Rule for answering questions',
      rule: 'When the user asks a question, provide accurate and helpful information based on available knowledge.',
      is_active: true,
    },
  ];

  // Seed AI rule data
  const aiRuleRepo = connection.getRepository(AiRule);
  const aiRuleCount = await aiRuleRepo.count();
  if (aiRuleCount < 1) {
    const embeddingService = new AiEmbeddingService();
    await embeddingService.initialize();

    for (const ruleData of aiRuleData) {
      const aiRule = aiRuleRepo.create(ruleData);
      const savedAiRule = await aiRuleRepo.save(aiRule);

      if (savedAiRule.rule && savedAiRule.rule.trim()) {
        await embeddingService.storeVector(savedAiRule.id, savedAiRule.rule, {
          name: savedAiRule.name,
          description: savedAiRule.description,
          is_active: savedAiRule.is_active,
        });
      }
    }

    console.log('✅ AI rule seed data has been added!');
  }
};
