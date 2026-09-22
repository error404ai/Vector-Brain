import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Counts how often a phone has started downloading a transfer.
 *
 * A phone that dies mid-download (an old APK buffering a 24 MB file on a
 * low-memory handset) comes back, is offered the same file, starts it, dies
 * again — and never posts a receipt, so the row stays PENDING and the phone is
 * stuck in a reconnect loop for good. With a count, the server gives up after a
 * few unfinished starts and marks the transfer FAILED.
 */
export class FileDownloadAttempts1790300000000 implements MigrationInterface {
  name = 'FileDownloadAttempts1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `device_file_transfers` ADD COLUMN `download_attempts` int NOT NULL DEFAULT 0 COMMENT 'Downloads started without a receipt'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `device_file_transfers` DROP COLUMN `download_attempts`');
  }
}
