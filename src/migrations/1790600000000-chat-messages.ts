import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Command chat transcript. The chat used to live only in the browser tab, so a
 * reload wiped the conversation (missions survived, the talk around them did
 * not). Each user message and each reply is kept here and replayed on load.
 */
export class ChatMessages1790600000000 implements MigrationInterface {
  name = 'ChatMessages1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`chat_messages\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`role\` varchar(10) NOT NULL,
        \`text\` text NOT NULL,
        \`reply\` longtext NULL,
        \`mission_id\` int NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_chat_messages_user\` (\`user_id\`, \`id\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `chat_messages`');
  }
}
