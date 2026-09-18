import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskQueue1789600000000 implements MigrationInterface {
  name = 'TaskQueue1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('queued_tasks')) return;

    await queryRunner.query(`
      CREATE TABLE \`queued_tasks\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`device_id\` int NOT NULL,
        \`proxy_id\` int NOT NULL,
        \`prompt\` text NOT NULL,
        \`ai_config_id\` int NULL,
        \`max_steps\` int NOT NULL DEFAULT 500,
        \`status\` varchar(16) NOT NULL DEFAULT 'QUEUED',
        \`last_error\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_queued_tasks_lane\` (\`proxy_id\`, \`status\`, \`id\`),
        CONSTRAINT \`FK_queued_tasks_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_queued_tasks_device\` FOREIGN KEY (\`device_id\`) REFERENCES \`android_devices\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_queued_tasks_proxy\` FOREIGN KEY (\`proxy_id\`) REFERENCES \`device_proxies\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('queued_tasks')) {
      await queryRunner.query('DROP TABLE `queued_tasks`');
    }
  }
}
