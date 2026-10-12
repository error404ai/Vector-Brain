import { MigrationInterface, QueryRunner } from 'typeorm';

/** Files phones send to the server (companion 0.32): metadata and the bytes in slices. */
export class DeviceUploads1792930000000 implements MigrationInterface {
  name = 'DeviceUploads1792930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TABLE IF NOT EXISTS `device_uploads` (`id` int NOT NULL AUTO_INCREMENT, `user_id` int NOT NULL, `device_id` int NOT NULL, `file_name` varchar(255) NOT NULL, `mime_type` varchar(150) NOT NULL DEFAULT 'application/octet-stream', `size_bytes` int NOT NULL, `sha256` varchar(64) NOT NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`), INDEX `IDX_device_uploads_user` (`user_id`, `id`)) ENGINE=InnoDB",
    );
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS `device_upload_chunks` (`upload_id` int NOT NULL, `chunk_index` int NOT NULL, `content` longblob NOT NULL, PRIMARY KEY (`upload_id`, `chunk_index`)) ENGINE=InnoDB',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `device_upload_chunks`');
    await queryRunner.query('DROP TABLE IF EXISTS `device_uploads`');
  }
}
