import { MigrationInterface, QueryRunner } from 'typeorm';

export class TelegramLinks1789200000000 implements MigrationInterface {
  name = 'TelegramLinks1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('telegram_links');
    if (exists) return;

    await queryRunner.query(`
      CREATE TABLE \`telegram_links\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`chat_id\` varchar(32) NULL,
        \`telegram_username\` varchar(64) NULL,
        \`default_device_id\` int NULL,
        \`link_code\` varchar(16) NULL,
        \`link_code_expires_at\` datetime NULL,
        \`linked_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`IDX_telegram_links_user\` (\`user_id\`),
        UNIQUE INDEX \`IDX_telegram_links_chat\` (\`chat_id\`),
        UNIQUE INDEX \`IDX_telegram_links_code\` (\`link_code\`),
        CONSTRAINT \`FK_telegram_links_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_telegram_links_device\` FOREIGN KEY (\`default_device_id\`) REFERENCES \`android_devices\`(\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('telegram_links');
    if (exists) {
      await queryRunner.query(`DROP TABLE \`telegram_links\``);
    }
  }
}
