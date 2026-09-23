import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Missions: one instruction in plain words, carried out across many phones.
 *
 * A mission owns a set of items — one per phone. The mission runner (a
 * deterministic loop, not an LLM) dispatches each item, follows its run,
 * retries failures that another attempt can fix, and writes a summary. State
 * lives here rather than in memory so a deploy mid-mission resumes it.
 */
export class Missions1790400000000 implements MigrationInterface {
  name = 'Missions1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`missions\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`request\` text NOT NULL,
        \`prompt\` text NULL,
        \`target_mode\` varchar(10) NOT NULL DEFAULT 'ids',
        \`requested_count\` int NULL,
        \`no_internet\` tinyint(1) NOT NULL DEFAULT 0,
        \`max_steps\` int NOT NULL DEFAULT 20,
        \`ai_config_id\` int NULL,
        \`status\` varchar(12) NOT NULL DEFAULT 'RUNNING',
        \`note\` varchar(500) NULL,
        \`summary\` text NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`finished_at\` datetime NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_missions_user\` (\`user_id\`, \`id\`),
        KEY \`IDX_missions_status\` (\`status\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`mission_items\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`mission_id\` int NOT NULL,
        \`device_id\` int NOT NULL,
        \`replaces_item_id\` int NULL,
        \`status\` varchar(12) NOT NULL DEFAULT 'PENDING',
        \`attempts\` int NOT NULL DEFAULT 0,
        \`agent_task_id\` int NULL,
        \`queue_id\` int NULL,
        \`last_reason\` varchar(40) NULL,
        \`last_message\` varchar(500) NULL,
        \`dispatched_at\` datetime NULL,
        \`next_attempt_at\` datetime NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_mission_items_mission\` (\`mission_id\`),
        CONSTRAINT \`FK_mission_items_mission\` FOREIGN KEY (\`mission_id\`) REFERENCES \`missions\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `mission_items`');
    await queryRunner.query('DROP TABLE IF EXISTS `missions`');
  }
}
