import { MigrationInterface, QueryRunner } from "typeorm";

export class UpgradeTaskLogsLongtext1787999950000 implements MigrationInterface {
    name = 'UpgradeTaskLogsLongtext1787999950000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` MODIFY COLUMN \`thought_reasoning\` longtext NULL`);
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` MODIFY COLUMN \`result_message\` longtext NULL`);
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` MODIFY COLUMN \`error_message\` longtext NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` MODIFY COLUMN \`thought_reasoning\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` MODIFY COLUMN \`result_message\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`android_task_logs\` MODIFY COLUMN \`error_message\` text NULL`);
    }
}
