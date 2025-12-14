import { AiRule } from '@/entities/AiRule';
import { AiEmbeddingService } from '@/services/AiEmbeddingService';
import { DataSource } from 'typeorm';

export const aiRuleSeed = async (connection: DataSource) => {
  const aiRuleData: Partial<AiRule>[] = [
    {
      user_id: 1,
      name: 'Blogger Blog Creation Rule',
      description: 'Rule for creating a new blog on Blogger when Gmail is logged in',
      rule: `When the user wants to create a new blog on Blogger, and a Gmail account is already logged into the browser:

1. Detect that a Google account is already active:
   - A profile avatar is visible in the top-right.
   - Blogger dashboard loads without asking for login.
   - No Gmail login form is displayed.

2. If the account is already logged in:
   - Skip the entire login flow.
   - Go directly to: https://www.blogger.com/home

3. Creating a new blog:
   - Click the "Create New Blog" button on the dashboard.
   - Generate a random blog title (human-like, not random characters).
   - Generate a unique Blogspot URL (e.g., using a random word combination).
   - Fill both the title and blog address fields.
   - Wait for Blogger to validate domain availability.
   - Once accepted, click "Create Blog".

4. After blog creation:
   - Wait for redirect to blog dashboard.
   - Do NOT start writing a post unless the user explicitly requests it.
   - Do NOT modify settings unless asked.

5. Avoid:
   - Ads and promotional pop-ups
   - Unrelated Google service links
   - Switching Google accounts unless user instructs

If Gmail is NOT logged in:
   - Trigger the standard Google login rule.`,
      is_active: true,
    },
    {
      user_id: 1,
      name: 'Twitter Like Rule',
      description: 'Rule for liking tweets on Twitter/X with state checking',
      rule: `When the user requests to like tweets on Twitter/X:

1. Before clicking the Like button on any tweet:
   - Check the current state of the Like icon.
   - If the tweet is already liked (heart is filled or highlighted):
       → Do NOT click it again.
   - If the tweet is not liked (heart is empty or outline):
       → Click Like once.

2. Never toggle the Like button multiple times.
   - Do not click rapidly.
   - Do not click twice on the same tweet.

3. After liking a tweet:
   - Wait briefly (1–2 seconds) to confirm the state has updated.
   - Verify the heart icon changed to "liked" state before moving on.

4. When liking multiple tweets (e.g., "like 5 tweets"):
   - Scroll slowly and select the first 5 tweets that match the instructions.
   - Apply the same state-checking rule for each tweet.
   - Skip tweets that are already liked.

5. Avoid:
   - Clicking Retweet, Reply, or Share by mistake.
   - Liking promoted ads unless user explicitly says to.
   - Re-liking tweets that are already in the correct state.

This rule ensures that the agent only performs a Like action, not an Unlike.`,
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
