import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per account: when the agent model is shown a screenshot ('off' | 'stuck' | 'every_step'; null = 'stuck'). */
export class AgentScreenshots1792200000000 implements MigrationInterface {
  name = 'AgentScreenshots1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('users', 'agent_screenshots'))) {
      await queryRunner.query('ALTER TABLE `users` ADD COLUMN `agent_screenshots` varchar(12) NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('users', 'agent_screenshots')) await queryRunner.query('ALTER TABLE `users` DROP COLUMN `agent_screenshots`');
  }
}
