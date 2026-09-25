import { MigrationInterface, QueryRunner } from 'typeorm';

/** Screens Vector showed in the chat, kept so they are still there after a reload. */
export class ChatScreenShots1791200000000 implements MigrationInterface {
  name = 'ChatScreenShots1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`chat_screen_shots\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`conversation_id\` int NULL,
        \`device_name\` varchar(150) NOT NULL,
        \`image\` mediumtext NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_chat_screen_user_created\` (\`user_id\`, \`created_at\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `chat_screen_shots`');
  }
}
