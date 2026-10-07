import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replay as the main engine (docs/REPLAY_ENGINE.md): the four account
 * switches, checkable flows, step fixes waiting to be trusted, and which flow
 * a run used.
 */
export class FlowEngine1792500000000 implements MigrationInterface {
  name = 'FlowEngine1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const add = async (table: string, column: string, definition: string) => {
      if (!(await queryRunner.hasColumn(table, column))) await queryRunner.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    };

    for (const column of ['flow_record', 'flow_replay_first', 'flow_ai_repair', 'flow_share_fixes']) {
      await add('users', column, 'tinyint NOT NULL DEFAULT 0');
    }

    await add('saved_flows', 'format', 'int NOT NULL DEFAULT 1');
    await add('saved_flows', 'enabled', 'tinyint NOT NULL DEFAULT 1');
    await add('saved_flows', 'version', 'int NOT NULL DEFAULT 1');
    await add('saved_flows', 'prompt_key', 'varchar(191) NULL');
    await add('saved_flows', 'template', 'text NULL');
    await add('saved_flows', 'params_json', 'text NULL');
    await add('saved_flows', 'package_name', 'varchar(150) NULL');
    await add('saved_flows', 'auto', 'tinyint NOT NULL DEFAULT 0');
    await add('saved_flows', 'checked', 'tinyint NOT NULL DEFAULT 0');
    await add('saved_flows', 'ai_steps', 'int NOT NULL DEFAULT 0');
    await add('saved_flows', 'stats', 'json NULL');
    await add('saved_flows', 'last_verified_at', 'datetime NULL');
    await add('saved_flows', 'previous_steps_json', 'longtext NULL');
    await add('saved_flows', 'fail_streak', 'int NOT NULL DEFAULT 0');
    await add('saved_flows', 'source_device_model', 'varchar(100) NULL');
    const flowIndexes = await queryRunner.query("SHOW INDEX FROM `saved_flows` WHERE Key_name = 'IDX_saved_flows_prompt'");
    if (!flowIndexes.length) await queryRunner.query('CREATE INDEX `IDX_saved_flows_prompt` ON `saved_flows` (`user_id`, `prompt_key`)');

    await add('agent_tasks', 'flow_id', 'int NULL');
    await add('agent_tasks', 'flow_mode', 'varchar(12) NULL');

    if (!(await queryRunner.hasTable('flow_patches'))) {
      await queryRunner.query(`
        CREATE TABLE \`flow_patches\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`flow_id\` int NOT NULL,
          \`flow_version\` int NOT NULL,
          \`step_index\` int NOT NULL,
          \`resume_index\` int NOT NULL,
          \`steps_json\` longtext NOT NULL,
          \`device_id\` int NULL,
          \`device_model\` varchar(100) NULL,
          \`status\` varchar(12) NOT NULL DEFAULT 'candidate',
          \`successes\` int NOT NULL DEFAULT 0,
          \`failures\` int NOT NULL DEFAULT 0,
          \`models\` json NULL,
          \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          PRIMARY KEY (\`id\`),
          INDEX \`IDX_flow_patches_flow\` (\`flow_id\`, \`flow_version\`, \`step_index\`),
          CONSTRAINT \`FK_flow_patches_flow\` FOREIGN KEY (\`flow_id\`) REFERENCES \`saved_flows\`(\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('flow_patches')) await queryRunner.query('DROP TABLE `flow_patches`');
    const drop = async (table: string, column: string) => {
      if (await queryRunner.hasColumn(table, column)) await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
    };
    for (const c of ['flow_id', 'flow_mode']) await drop('agent_tasks', c);
    const flowIndexes = await queryRunner.query("SHOW INDEX FROM `saved_flows` WHERE Key_name = 'IDX_saved_flows_prompt'");
    if (flowIndexes.length) await queryRunner.query('DROP INDEX `IDX_saved_flows_prompt` ON `saved_flows`');
    for (const c of ['format', 'enabled', 'version', 'prompt_key', 'template', 'params_json', 'package_name', 'auto', 'checked', 'ai_steps', 'stats', 'last_verified_at', 'previous_steps_json', 'fail_streak', 'source_device_model']) {
      await drop('saved_flows', c);
    }
    for (const c of ['flow_record', 'flow_replay_first', 'flow_ai_repair', 'flow_share_fixes']) await drop('users', c);
  }
}
