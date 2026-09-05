import { MigrationInterface, QueryRunner } from 'typeorm';

export class SavedFlows1788800000000 implements MigrationInterface {
  name = 'SavedFlows1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('saved_flows');
    if (exists) return;

    await queryRunner.query(`
      CREATE TABLE \`saved_flows\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`name\` varchar(150) NOT NULL,
        \`source_prompt\` text NULL,
        \`source_task_id\` int NULL,
        \`steps_json\` longtext NOT NULL,
        \`step_count\` int NOT NULL DEFAULT 0,
        \`coordinate_step_count\` int NOT NULL DEFAULT 0,
        \`run_count\` int NOT NULL DEFAULT 0,
        \`last_run_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_saved_flows_user\` (\`user_id\`),
        CONSTRAINT \`FK_saved_flows_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('saved_flows');
    if (exists) {
      await queryRunner.query(`DROP TABLE \`saved_flows\``);
    }
  }
}
