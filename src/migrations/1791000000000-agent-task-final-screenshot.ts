import { MigrationInterface, QueryRunner } from 'typeorm';

/** One final screenshot per task, so the mission card can show each phone's last screen after it finishes. */
export class AgentTaskFinalScreenshot1791000000000 implements MigrationInterface {
  name = 'AgentTaskFinalScreenshot1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `agent_tasks` ADD COLUMN `final_screenshot` mediumtext NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `agent_tasks` DROP COLUMN `final_screenshot`');
  }
}
