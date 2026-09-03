import { MigrationInterface, QueryRunner } from 'typeorm';

export class RunSharing1788600000000 implements MigrationInterface {
  name = 'RunSharing1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('agent_tasks');

    if (table && !table.findColumnByName('share_token')) {
      await queryRunner.query(`ALTER TABLE \`agent_tasks\` ADD \`share_token\` varchar(32) NULL`);
      await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_agent_tasks_share_token\` ON \`agent_tasks\` (\`share_token\`)`);
    }
    if (table && !table.findColumnByName('shared_at')) {
      await queryRunner.query(`ALTER TABLE \`agent_tasks\` ADD \`shared_at\` datetime NULL`);
    }

    const framesExist = await queryRunner.hasTable('shared_run_frames');
    if (!framesExist) {
      // Frames are copied here rather than referenced from android_task_logs so
      // a shared link keeps working after log cleanup, and so nothing private
      // (UI trees, device ids) can leak through the public endpoint.
      await queryRunner.query(`
        CREATE TABLE \`shared_run_frames\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`agent_task_id\` int NOT NULL,
          \`step_index\` int NOT NULL,
          \`caption\` varchar(500) NULL,
          \`image_base64\` longtext NOT NULL,
          \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          PRIMARY KEY (\`id\`),
          INDEX \`IDX_shared_run_frames_task\` (\`agent_task_id\`),
          CONSTRAINT \`FK_shared_run_frames_task\` FOREIGN KEY (\`agent_task_id\`) REFERENCES \`agent_tasks\`(\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const framesExist = await queryRunner.hasTable('shared_run_frames');
    if (framesExist) {
      await queryRunner.query(`DROP TABLE \`shared_run_frames\``);
    }

    const table = await queryRunner.getTable('agent_tasks');
    if (table && table.findColumnByName('share_token')) {
      await queryRunner.query(`DROP INDEX \`IDX_agent_tasks_share_token\` ON \`agent_tasks\``);
      await queryRunner.query(`ALTER TABLE \`agent_tasks\` DROP COLUMN \`share_token\``);
    }
    if (table && table.findColumnByName('shared_at')) {
      await queryRunner.query(`ALTER TABLE \`agent_tasks\` DROP COLUMN \`shared_at\``);
    }
  }
}
