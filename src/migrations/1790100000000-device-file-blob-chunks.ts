import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Large files are stored as rows of a few megabytes each.
 *
 * MySQL refuses any single statement larger than max_allowed_packet, and the
 * result of CONCAT is bound by the same ceiling, so a 24 MB APK cannot be
 * written into one column on a server with the common 16 MB setting — it was
 * rejected, while the transfer rows were queued anyway, leaving phones offered
 * a file whose bytes were never stored. Slices sidestep the limit completely
 * and keep delivery's memory flat, whatever the server is configured with.
 */
export class DeviceFileBlobChunks1790100000000 implements MigrationInterface {
  name = 'DeviceFileBlobChunks1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`device_file_blob_chunks\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`sha256\` varchar(64) NOT NULL,
        \`chunk_index\` int NOT NULL,
        \`content\` longblob NOT NULL,
        \`size_bytes\` int NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_blob_chunk\` (\`sha256\`, \`chunk_index\`),
        INDEX \`IDX_blob_chunk_sha\` (\`sha256\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `device_file_blob_chunks`');
  }
}
