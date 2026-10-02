import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whether the AI saw the phone's screen as an image: per step (seen + why
 * not), per run and per mission item (totals, see screenSight.ts).
 */
export class ScreenSight1792400000000 implements MigrationInterface {
  name = 'ScreenSight1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('android_task_logs', 'sight'))) {
      await queryRunner.query('ALTER TABLE `android_task_logs` ADD COLUMN `sight` varchar(8) NULL, ADD COLUMN `sight_why` varchar(20) NULL');
    }
    if (!(await queryRunner.hasColumn('agent_tasks', 'sight'))) {
      await queryRunner.query('ALTER TABLE `agent_tasks` ADD COLUMN `sight` json NULL');
    }
    if (!(await queryRunner.hasColumn('mission_items', 'sight'))) {
      await queryRunner.query('ALTER TABLE `mission_items` ADD COLUMN `sight` json NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('mission_items', 'sight')) await queryRunner.query('ALTER TABLE `mission_items` DROP COLUMN `sight`');
    if (await queryRunner.hasColumn('agent_tasks', 'sight')) await queryRunner.query('ALTER TABLE `agent_tasks` DROP COLUMN `sight`');
    if (await queryRunner.hasColumn('android_task_logs', 'sight')) {
      await queryRunner.query('ALTER TABLE `android_task_logs` DROP COLUMN `sight`, DROP COLUMN `sight_why`');
    }
  }
}
