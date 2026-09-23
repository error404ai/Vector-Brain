import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Timed runs ("browse for 1 hour"). The agent has no clock and ends a task as
 * soon as it thinks the goal is met, so a duration is enforced by the server:
 * the run keeps starting fresh rounds on the same task until the time is up.
 * Missions remember the duration; queued lane entries carry it to the start.
 */
export class TimedRuns1790700000000 implements MigrationInterface {
  name = 'TimedRuns1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `missions` ADD COLUMN `duration_seconds` int NULL COMMENT 'Keep each phone working this long'");
    await queryRunner.query("ALTER TABLE `queued_tasks` ADD COLUMN `run_seconds` int NULL COMMENT 'Timed run length once started'");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `queued_tasks` DROP COLUMN `run_seconds`');
    await queryRunner.query('ALTER TABLE `missions` DROP COLUMN `duration_seconds`');
  }
}
