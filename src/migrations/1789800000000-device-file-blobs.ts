import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Content-addressed storage for device file transfers.
 *
 * Adds device_file_blobs, which holds one copy of a file's bytes keyed by its
 * SHA-256, and relaxes device_file_transfers.content to nullable so new rows
 * point at a shared blob instead of each carrying their own copy. Existing rows
 * keep their inline content and still deliver through the legacy path; nothing
 * is back-filled, because pending transfers are short-lived and expire within a
 * week anyway.
 */
export class DeviceFileBlobs1789800000000 implements MigrationInterface {
  name = 'DeviceFileBlobs1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasBlobs = await queryRunner.hasTable('device_file_blobs');
    if (!hasBlobs) {
      await queryRunner.query(`
        CREATE TABLE \`device_file_blobs\` (
          \`sha256\` varchar(64) NOT NULL,
          \`size_bytes\` int NOT NULL,
          \`content\` longblob NOT NULL,
          \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          PRIMARY KEY (\`sha256\`)
        ) ENGINE=InnoDB
      `);
    }

    // Relax content to nullable — guard so a re-run does not error.
    const table = await queryRunner.getTable('device_file_transfers');
    const contentColumn = table?.findColumnByName('content');
    if (contentColumn && !contentColumn.isNullable) {
      await queryRunner.query(
        'ALTER TABLE `device_file_transfers` MODIFY `content` longblob NULL',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasBlobs = await queryRunner.hasTable('device_file_blobs');
    if (hasBlobs) {
      await queryRunner.query('DROP TABLE `device_file_blobs`');
    }
    // content stays nullable on the way down: forcing NOT NULL would reject any
    // row written by the new path, which legitimately has a null content.
  }
}
