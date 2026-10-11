import { MigrationInterface, QueryRunner } from 'typeorm';

/** device_file_transfers.status gains CANCELLED: a send stopped from the dashboard. */
export class FileTransferCancelled1792900000000 implements MigrationInterface {
  name = 'FileTransferCancelled1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `device_file_transfers` MODIFY `status` enum('PENDING','DELIVERED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("UPDATE `device_file_transfers` SET `status` = 'FAILED' WHERE `status` = 'CANCELLED'");
    await queryRunner.query(
      "ALTER TABLE `device_file_transfers` MODIFY `status` enum('PENDING','DELIVERED','FAILED') NOT NULL DEFAULT 'PENDING'",
    );
  }
}
