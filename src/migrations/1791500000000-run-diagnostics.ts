import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Run diagnostics: what each step saw before and after, where its time went,
 * what the model spent on it, and whether it was wasted.
 *
 * Every column is nullable and additive, so older rows and older code keep
 * working; ui_tree_snapshot keeps its meaning (the screen after the step).
 */
export class RunDiagnostics1791500000000 implements MigrationInterface {
  name = 'RunDiagnostics1791500000000';

  private readonly logColumns: [string, string][] = [
    ['ui_tree_before', 'longtext NULL'],
    ['package_before', 'varchar(150) NULL'],
    ['package_after', 'varchar(150) NULL'],
    ['screen_before', 'varchar(16) NULL'],
    ['screen_after', 'varchar(16) NULL'],
    ['think_ms', 'int NULL'],
    ['llm_call', 'int NULL'],
    ['prompt_tokens', 'int NULL'],
    ['completion_tokens', 'int NULL'],
    ['source', "varchar(12) NOT NULL DEFAULT 'ai'"],
    ['waste', 'varchar(20) NULL'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, definition] of this.logColumns) {
      if (!(await queryRunner.hasColumn('android_task_logs', name))) {
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` ADD COLUMN \`${name}\` ${definition}`);
      }
    }
    if (!(await queryRunner.hasColumn('agent_tasks', 'diagnostics'))) {
      await queryRunner.query('ALTER TABLE `agent_tasks` ADD COLUMN `diagnostics` json NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('agent_tasks', 'diagnostics')) {
      await queryRunner.query('ALTER TABLE `agent_tasks` DROP COLUMN `diagnostics`');
    }
    for (const [name] of [...this.logColumns].reverse()) {
      if (await queryRunner.hasColumn('android_task_logs', name)) {
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` DROP COLUMN \`${name}\``);
      }
    }
  }
}
