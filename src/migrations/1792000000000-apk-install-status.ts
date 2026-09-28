import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where a pushed APK update stands on the phone: downloaded, waiting for the
 * install permission, waiting for a tap, installed or failed. The file receipt
 * only says the bytes landed; these columns say whether the update did.
 */
export class ApkInstallStatus1792000000000 implements MigrationInterface {
  name = 'ApkInstallStatus1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('device_file_transfers', 'install_status'))) {
      await queryRunner.query('ALTER TABLE `device_file_transfers` ADD COLUMN `install_status` varchar(32) NULL');
    }
    if (!(await queryRunner.hasColumn('device_file_transfers', 'install_message'))) {
      await queryRunner.query('ALTER TABLE `device_file_transfers` ADD COLUMN `install_message` varchar(500) NULL');
    }
    if (!(await queryRunner.hasColumn('device_file_transfers', 'install_updated_at'))) {
      await queryRunner.query('ALTER TABLE `device_file_transfers` ADD COLUMN `install_updated_at` datetime NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['install_updated_at', 'install_message', 'install_status']) {
      if (await queryRunner.hasColumn('device_file_transfers', column)) {
        await queryRunner.query(`ALTER TABLE \`device_file_transfers\` DROP COLUMN \`${column}\``);
      }
    }
  }
}
