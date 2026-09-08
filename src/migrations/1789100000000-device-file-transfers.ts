import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeviceFileTransfers1789100000000 implements MigrationInterface {
  name = 'DeviceFileTransfers1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('device_file_transfers');
    if (exists) return;

    await queryRunner.query(`
      CREATE TABLE \`device_file_transfers\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`device_id\` int NOT NULL,
        \`file_name\` varchar(255) NOT NULL,
        \`mime_type\` varchar(150) NOT NULL DEFAULT 'application/octet-stream',
        \`size_bytes\` int NOT NULL,
        \`sha256\` varchar(64) NOT NULL,
        \`content\` longblob NOT NULL,
        \`status\` enum('PENDING','DELIVERED','FAILED') NOT NULL DEFAULT 'PENDING',
        \`failure_message\` varchar(500) NULL,
        \`delivered_at\` datetime NULL,
        \`expires_at\` datetime NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_device_files_device_status\` (\`device_id\`, \`status\`),
        INDEX \`IDX_device_files_expires\` (\`expires_at\`),
        CONSTRAINT \`FK_device_files_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_device_files_device\` FOREIGN KEY (\`device_id\`) REFERENCES \`android_devices\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('device_file_transfers');
    if (exists) {
      await queryRunner.query(`DROP TABLE \`device_file_transfers\``);
    }
  }
}
