import { MigrationInterface, QueryRunner } from 'typeorm';

/** When a queue entry moved to STARTING, so the stale-STARTING sweep times from the launch, not from when it was queued. */
export class QueuedTaskStartingAt1791100000000 implements MigrationInterface {
  name = 'QueuedTaskStartingAt1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `queued_tasks` ADD COLUMN `starting_at` datetime NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `queued_tasks` DROP COLUMN `starting_at`');
  }
}
