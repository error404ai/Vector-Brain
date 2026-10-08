import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per model call: cached input, cache writes, hidden reasoning and the billed cost. */
export class TokenBreakdown1792610000000 implements MigrationInterface {
  name = 'TokenBreakdown1792610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [column, definition] of [
      ['cache_read_tokens', 'int NULL'],
      ['cache_write_tokens', 'int NULL'],
      ['reasoning_tokens', 'int NULL'],
      ['cost_usd', 'double NULL'],
    ]) {
      if (!(await queryRunner.hasColumn('android_task_logs', column))) {
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` ADD COLUMN \`${column}\` ${definition}`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['cost_usd', 'reasoning_tokens', 'cache_write_tokens', 'cache_read_tokens']) {
      if (await queryRunner.hasColumn('android_task_logs', column)) await queryRunner.query(`ALTER TABLE \`android_task_logs\` DROP COLUMN \`${column}\``);
    }
  }
}
