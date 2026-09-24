import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat history as separate conversations (like ChatGPT/Claude): a sidebar of
 * past chats, each its own thread. Adds a conversations table and ties every
 * chat_messages row to one. Existing messages are folded into a single
 * "Earlier chat" per user so nothing is lost, and the agent's context is then
 * scoped to one conversation instead of the whole history.
 */
export class Conversations1790900000000 implements MigrationInterface {
  name = 'Conversations1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`conversations\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`title\` varchar(120) NOT NULL DEFAULT 'New chat',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`last_message_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_conversations_user\` (\`user_id\`, \`last_message_at\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(
      "ALTER TABLE `chat_messages` ADD COLUMN `conversation_id` int NULL",
    );
    // Fold each user's existing loose messages into one conversation so the
    // history survives the switch to threads.
    const users: { user_id: number }[] = await queryRunner.query(
      'SELECT DISTINCT user_id FROM chat_messages WHERE conversation_id IS NULL',
    );
    for (const { user_id } of users) {
      const inserted = await queryRunner.query(
        "INSERT INTO conversations (user_id, title, created_at, last_message_at) SELECT ?, 'Earlier chat', MIN(created_at), MAX(created_at) FROM chat_messages WHERE user_id = ? AND conversation_id IS NULL",
        [user_id, user_id],
      );
      const conversationId = inserted.insertId;
      await queryRunner.query('UPDATE chat_messages SET conversation_id = ? WHERE user_id = ? AND conversation_id IS NULL', [conversationId, user_id]);
    }
    await queryRunner.query('CREATE INDEX `IDX_chat_messages_conversation` ON `chat_messages` (`conversation_id`, `id`)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `IDX_chat_messages_conversation` ON `chat_messages`');
    await queryRunner.query('ALTER TABLE `chat_messages` DROP COLUMN `conversation_id`');
    await queryRunner.query('DROP TABLE IF EXISTS `conversations`');
  }
}
