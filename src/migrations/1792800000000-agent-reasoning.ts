import { MigrationInterface, QueryRunner } from 'typeorm';

/** users.agent_reasoning: Lite — 'off' | 'hard' | 'always'; null = 'hard'. */
export class AgentReasoning1792800000000 implements MigrationInterface {
  name = 'AgentReasoning1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('users', 'agent_reasoning'))) {
      await queryRunner.query('ALTER TABLE `users` ADD COLUMN `agent_reasoning` varchar(8) NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('users', 'agent_reasoning')) await queryRunner.query('ALTER TABLE `users` DROP COLUMN `agent_reasoning`');
  }
}
