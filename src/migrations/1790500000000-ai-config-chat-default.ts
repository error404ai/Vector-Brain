import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marks one AI config as the model the Command chat uses.
 *
 * The chat that drives the fleet from plain language needs a reliable model,
 * kept separate from whatever the phones' fleet model is. A free model here
 * hits its per-day cap and stalls the chat, so the UI steers users to a paid
 * one; this flag records which config they picked.
 */
export class AiConfigChatDefault1790500000000 implements MigrationInterface {
  name = 'AiConfigChatDefault1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `ai_configs` ADD COLUMN `is_chat_default` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'The model the Command chat uses'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `ai_configs` DROP COLUMN `is_chat_default`');
  }
}
