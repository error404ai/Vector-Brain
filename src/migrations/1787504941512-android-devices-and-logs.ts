import { MigrationInterface, QueryRunner } from "typeorm";

export class AndroidDevicesAndLogs1787504941512 implements MigrationInterface {
    name = 'AndroidDevicesAndLogs1787504941512'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_browserworker_errors_code\` ON \`browserworker_errors\``);
        await queryRunner.query(`DROP INDEX \`IDX_browserworker_errors_last_seen\` ON \`browserworker_errors\``);
        await queryRunner.query(`CREATE TABLE \`android_devices\` (\`id\` int NOT NULL AUTO_INCREMENT, \`user_id\` int NOT NULL, \`device_id\` varchar(100) NOT NULL, \`device_name\` varchar(150) NOT NULL, \`device_model\` varchar(100) NULL, \`android_version\` varchar(50) NULL, \`pairing_code\` varchar(10) NULL, \`pairing_expires_at\` datetime NULL, \`device_token\` varchar(255) NULL, \`status\` enum ('ONLINE', 'OFFLINE', 'BUSY') NOT NULL DEFAULT 'OFFLINE', \`last_seen_at\` datetime NULL, \`capabilities\` json NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_a3ce368516a397ee2e5cbd7cde\` (\`device_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`android_task_logs\` (\`id\` int NOT NULL AUTO_INCREMENT, \`agent_task_id\` int NOT NULL, \`device_id\` int NULL, \`step_index\` int NOT NULL, \`action_type\` varchar(50) NOT NULL, \`action_payload\` json NULL, \`thought_reasoning\` text NULL, \`status\` enum ('PENDING', 'EXECUTING', 'SUCCESS', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING', \`screenshot_base64\` longtext NULL, \`ui_tree_snapshot\` json NULL, \`duration_ms\` int NOT NULL DEFAULT '0', \`result_message\` text NULL, \`error_message\` text NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`android_devices\` ADD CONSTRAINT \`FK_ac5a60ae51273295db209c2d4ac\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` ADD CONSTRAINT \`FK_467bb4333748bf0f35176a49070\` FOREIGN KEY (\`agent_task_id\`) REFERENCES \`agent_tasks\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` ADD CONSTRAINT \`FK_7fee12a469e5526ea395b2921e5\` FOREIGN KEY (\`device_id\`) REFERENCES \`android_devices\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` DROP FOREIGN KEY \`FK_7fee12a469e5526ea395b2921e5\``);
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` DROP FOREIGN KEY \`FK_467bb4333748bf0f35176a49070\``);
        await queryRunner.query(`ALTER TABLE \`android_devices\` DROP FOREIGN KEY \`FK_ac5a60ae51273295db209c2d4ac\``);
        await queryRunner.query(`DROP TABLE \`android_task_logs\``);
        await queryRunner.query(`DROP INDEX \`IDX_a3ce368516a397ee2e5cbd7cde\` ON \`android_devices\``);
        await queryRunner.query(`DROP TABLE \`android_devices\``);
        await queryRunner.query(`CREATE INDEX \`IDX_browserworker_errors_last_seen\` ON \`browserworker_errors\` (\`last_seen_at\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_browserworker_errors_code\` ON \`browserworker_errors\` (\`error_code\`)`);
    }

}
