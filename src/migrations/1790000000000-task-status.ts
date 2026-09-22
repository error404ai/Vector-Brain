import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1: task lifecycle stored in the database.
 *
 * Adds status, reason_code, started_at, finished_at and lease_until to
 * agent_tasks, then backfills existing rows from the old success/message pair:
 * successful runs become SUCCEEDED, runs whose message says they were cancelled
 * become CANCELLED, and everything else FAILED. Anything that was mid-run when
 * this deploy restarted the server is therefore closed out rather than left
 * looking alive.
 */
export class TaskStatus1790000000000 implements MigrationInterface {
  name = 'TaskStatus1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('agent_tasks');
    if (!table) return;

    const add = async (column: string, ddl: string) => {
      if (!table.findColumnByName(column)) {
        await queryRunner.query(`ALTER TABLE \`agent_tasks\` ADD ${ddl}`);
      }
    };
    await add('status', "`status` varchar(20) NOT NULL DEFAULT 'FAILED'");
    await add('reason_code', '`reason_code` varchar(40) NULL');
    await add('started_at', '`started_at` datetime NULL');
    await add('finished_at', '`finished_at` datetime NULL');
    await add('lease_until', '`lease_until` datetime NULL');

    await queryRunner.query("UPDATE `agent_tasks` SET `status` = 'SUCCEEDED' WHERE `success` = 1");
    await queryRunner.query(
      "UPDATE `agent_tasks` SET `status` = 'CANCELLED', `reason_code` = 'USER_CANCELLED' " +
        "WHERE `success` = 0 AND `message` LIKE 'Task cancelled%'",
    );
    await queryRunner.query('UPDATE `agent_tasks` SET `finished_at` = `updated_at` WHERE `finished_at` IS NULL');

    const indexes = (await queryRunner.getTable('agent_tasks'))?.indices ?? [];
    if (!indexes.some((index) => index.name === 'IDX_agent_tasks_status_lease')) {
      await queryRunner.query('CREATE INDEX `IDX_agent_tasks_status_lease` ON `agent_tasks` (`status`, `lease_until`)');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('agent_tasks');
    if (!table) return;
    if (table.indices.some((index) => index.name === 'IDX_agent_tasks_status_lease')) {
      await queryRunner.query('DROP INDEX `IDX_agent_tasks_status_lease` ON `agent_tasks`');
    }
    for (const column of ['lease_until', 'finished_at', 'started_at', 'reason_code', 'status']) {
      if (table.findColumnByName(column)) {
        await queryRunner.query(`ALTER TABLE \`agent_tasks\` DROP COLUMN \`${column}\``);
      }
    }
  }
}
