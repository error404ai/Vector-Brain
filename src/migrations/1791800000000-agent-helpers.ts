import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per account: the vision model that reads screens for a text-only agent model, and the backup model. */
export class AgentHelpers1791800000000 implements MigrationInterface {
  name = 'AgentHelpers1791800000000';

  private readonly columns: [string, string][] = [
    ['agent_vision_config_id', 'int NULL'],
    ['agent_fallback_config_id', 'int NULL'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, definition] of this.columns) {
      if (!(await queryRunner.hasColumn('users', name))) await queryRunner.query(`ALTER TABLE \`users\` ADD COLUMN \`${name}\` ${definition}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name] of [...this.columns].reverse()) {
      if (await queryRunner.hasColumn('users', name)) await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`${name}\``);
    }
  }
}
