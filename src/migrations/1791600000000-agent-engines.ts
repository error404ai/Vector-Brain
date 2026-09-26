import { MigrationInterface, QueryRunner } from 'typeorm';

/** Engine switch: which engine each run used, its verification, and each account's choice. */
export class AgentEngines1791600000000 implements MigrationInterface {
  name = 'AgentEngines1791600000000';

  private readonly columns: [string, string, string][] = [
    ['agent_tasks', 'engine', 'varchar(12) NULL'],
    ['agent_tasks', 'verification', 'json NULL'],
    ['users', 'agent_engine', 'varchar(12) NULL'],
    ['users', 'agent_planner', 'tinyint NOT NULL DEFAULT 0'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, name, definition] of this.columns) {
      if (!(await queryRunner.hasColumn(table, name))) {
        await queryRunner.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, name] of [...this.columns].reverse()) {
      if (await queryRunner.hasColumn(table, name)) await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${name}\``);
    }
  }
}
