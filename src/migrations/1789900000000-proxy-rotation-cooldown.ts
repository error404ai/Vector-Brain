import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a per-proxy rotation cooldown.
 *
 * Rotation used to fire on every finished task, which hammered the provider's
 * rotation endpoint and earned 429s when tasks finished within the provider's
 * one-per-60s window. This column records the minimum gap the provider allows,
 * defaulting to 60s, and the rotation service now waits it out instead of
 * calling into a rate limit.
 */
export class ProxyRotationCooldown1789900000000 implements MigrationInterface {
  name = 'ProxyRotationCooldown1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('device_proxies');
    if (table && !table.findColumnByName('min_rotation_gap_seconds')) {
      await queryRunner.query(
        'ALTER TABLE `device_proxies` ADD `min_rotation_gap_seconds` int NOT NULL DEFAULT 60',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('device_proxies');
    if (table && table.findColumnByName('min_rotation_gap_seconds')) {
      await queryRunner.query('ALTER TABLE `device_proxies` DROP COLUMN `min_rotation_gap_seconds`');
    }
  }
}
