import { MigrationInterface, QueryRunner } from 'typeorm';

/** Pause / Resume for missions: when it was paused, and how long each phone already worked. */
export class MissionPause1792100000000 implements MigrationInterface {
  name = 'MissionPause1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('missions', 'paused_at'))) {
      await queryRunner.query('ALTER TABLE `missions` ADD COLUMN `paused_at` datetime NULL');
    }
    if (!(await queryRunner.hasColumn('mission_items', 'run_seconds'))) {
      await queryRunner.query('ALTER TABLE `mission_items` ADD COLUMN `run_seconds` int NOT NULL DEFAULT 0');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('mission_items', 'run_seconds')) await queryRunner.query('ALTER TABLE `mission_items` DROP COLUMN `run_seconds`');
    if (await queryRunner.hasColumn('missions', 'paused_at')) await queryRunner.query('ALTER TABLE `missions` DROP COLUMN `paused_at`');
  }
}
