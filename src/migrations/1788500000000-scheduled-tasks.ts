import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScheduledTasks1788500000000 implements MigrationInterface {
  name = 'ScheduledTasks1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('scheduled_tasks');
    if (exists) return;

    await queryRunner.query(`
      CREATE TABLE \`scheduled_tasks\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`device_id\` int NOT NULL,
        \`prompt\` varchar(500) NOT NULL,
        \`run_at\` varchar(5) NOT NULL,
        \`days_of_week\` varchar(20) NOT NULL DEFAULT '',
        \`timezone\` varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
        \`max_steps\` int NOT NULL DEFAULT 40,
        \`ai_config_id\` int NULL,
        \`enabled\` tinyint NOT NULL DEFAULT 1,
        \`last_run_at\` datetime NULL,
        \`last_result\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_scheduled_tasks_user\` (\`user_id\`),
        INDEX \`IDX_scheduled_tasks_enabled\` (\`enabled\`),
        CONSTRAINT \`FK_scheduled_tasks_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_scheduled_tasks_device\` FOREIGN KEY (\`device_id\`) REFERENCES \`android_devices\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('scheduled_tasks');
    if (exists) {
      await queryRunner.query(`DROP TABLE \`scheduled_tasks\``);
    }
  }
}
