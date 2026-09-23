import { MigrationInterface, QueryRunner } from 'typeorm';

/** "Continue": a mission item that picks an earlier run back up instead of starting fresh. */
export class MissionContinue1790800000000 implements MigrationInterface {
  name = 'MissionContinue1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `mission_items` ADD COLUMN `continue_from_task_id` int NULL COMMENT 'Run to pick back up'");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `mission_items` DROP COLUMN `continue_from_task_id`');
  }
}
