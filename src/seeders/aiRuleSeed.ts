import { AiRule } from '@/entities/AiRule';
import { AiEmbeddingService } from '@/services/AiEmbeddingService';
import { DataSource } from 'typeorm';

export const aiRuleSeed = async (connection: DataSource) => {
  const aiRuleData: Partial<AiRule>[] = [
    {
      user_id: 1,
      name: 'Blogger Blog Creation Rule',
      website: 'https://blogger.com',
      intent: 'Create a new blog on Blogger when Gmail account is already logged in',
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
      name: 'Twitter Like Rule - Basic State Checking',
      website: 'https://x.com',
      intent: 'Like tweets on Twitter/X with proper state checking to avoid double-liking',
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
    {
      user_id: 1,
      name: 'Twitter Like Rule - Timeline Focused',
      website: 'https://x.com',
      intent: 'Like tweets on Twitter/X while staying on the user timeline without opening tweet details',
      rule: `When the user requests to like tweets on Twitter/X, follow these rules:

1. Stay on the target user's main profile timeline.
   - Do NOT open individual tweet pages unless the user explicitly asks.
   - Avoid clicking the tweet text, username, or timestamp.
   - Only interact with the Like button on the timeline list view.

2. Before liking a tweet:
   - Check if the Like icon is already active (filled heart).
   - If active → SKIP that tweet.
   - If inactive → Click Like once.

3. After clicking Like:
   - DO NOT click anything else on the tweet.
   - DO NOT re-open the tweet.
   - DO NOT toggle it again.
   - Move to the next visible tweet.

4. Scrolling rules:
   - Scroll the timeline slowly to reveal new tweets.
   - Do NOT scroll too fast or jump back to the top.
   - Only scroll AFTER you have processed all visible tweets.

5. Avoid:
   - Opening tweet detail pages.
   - Liking promoted/advertisement tweets.
   - Clicking reply, retweet, share, or analytics icons.
   - Leaving the user's timeline page.

6. Liking multiple tweets:
   - Maintain a counter.
   - Like only the first N tweets that are NOT already liked.
   - Stop immediately after reaching the requested number.

This rule ensures stability: remain on the user timeline, never enter tweet pages, and like tweets safely without toggling.`,
      is_active: true,
    },
    {
      user_id: 1,
      name: 'Twitter Like Rule - No Detail Pages',
      website: 'https://x.com',
      intent: 'Like tweets on Twitter/X while strictly staying in timeline view and never opening tweet detail pages',
      rule: `When liking tweets on Twitter/X, the agent must NEVER open the tweet detail page.

1. You must stay ONLY on the timeline list view.
   - Do NOT click the tweet body, username, timestamp, media, or text.
   - Only interact with the heart icon inside the timeline list.

2. If a click accidentally opens a tweet detail page:
   - Immediately return to the timeline using the browser back button.
   - Do NOT like or interact with tweets inside the detail page.
   - Resume from the previous scroll position.

3. How to like tweets:
   - Locate ONLY the heart icon in the list view.
   - Check if it is already active (filled heart).
     • If active → SKIP.
     • If inactive → click once.
   - After liking, do NOT click anything else on that tweet.

4. Scrolling rules:
   - Scroll slowly and linearly downwards.
   - Do NOT scroll back to the top.
   - Do NOT reload the page.

5. Liking multiple tweets:
   - Keep a counter and stop when the number of likes is reached.
   - Skip replies, promoted tweets, and ads.
   - Skip tweets already liked.

6. Forbidden actions:
   - Opening tweet details.
   - Clicking tweet bodies.
   - Liking inside tweet detail view.
   - Re-liking (unliking) tweets.
   - Navigating to replies or threads.

The agent must stay in the timeline list view the entire time and`,
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
          website: savedAiRule.website,
          is_active: savedAiRule.is_active,
        });
      }
    }

    console.log('✅ AI rule seed data has been added!');
  }
};
