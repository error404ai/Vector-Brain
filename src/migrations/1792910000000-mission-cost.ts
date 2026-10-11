import { MigrationInterface, QueryRunner } from 'typeorm';

/** missions.estimate_usd (the Confirm card's estimate) and mission_items.run_task_ids (every run, for the real cost). */
export class MissionCost1792910000000 implements MigrationInterface {
  name = 'MissionCost1792910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('missions', 'estimate_usd'))) {
      await queryRunner.query('ALTER TABLE `missions` ADD COLUMN `estimate_usd` decimal(12,6) NULL');
    }
    if (!(await queryRunner.hasColumn('mission_items', 'run_task_ids'))) {
      await queryRunner.query('ALTER TABLE `mission_items` ADD COLUMN `run_task_ids` json NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('missions', 'estimate_usd')) await queryRunner.query('ALTER TABLE `missions` DROP COLUMN `estimate_usd`');
    if (await queryRunner.hasColumn('mission_items', 'run_task_ids')) await queryRunner.query('ALTER TABLE `mission_items` DROP COLUMN `run_task_ids`');
  }
}
