import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeviceProxies1789500000000 implements MigrationInterface {
  name = 'DeviceProxies1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('device_proxies');
    if (!hasTable) {
      await queryRunner.query(`
        CREATE TABLE \`device_proxies\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`user_id\` int NOT NULL,
          \`name\` varchar(100) NOT NULL,
          \`rotation_url\` varchar(500) NOT NULL,
          \`concurrency\` int NOT NULL DEFAULT 1,
          \`settle_seconds\` int NOT NULL DEFAULT 5,
          \`rotate_every_tasks\` int NOT NULL DEFAULT 1,
          \`tasks_since_rotation\` int NOT NULL DEFAULT 0,
          \`last_rotation_status\` varchar(255) NULL,
          \`last_ip\` varchar(64) NULL,
          \`last_rotated_at\` datetime NULL,
          \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          PRIMARY KEY (\`id\`),
          INDEX \`IDX_device_proxies_user\` (\`user_id\`),
          CONSTRAINT \`FK_device_proxies_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);
    }

    const devices = await queryRunner.getTable('android_devices');
    if (devices && !devices.findColumnByName('proxy_id')) {
      await queryRunner.query('ALTER TABLE `android_devices` ADD `proxy_id` int NULL');
      // SET NULL rather than CASCADE: deleting a proxy must never delete the
      // phones that were using it.
      await queryRunner.query(
        'ALTER TABLE `android_devices` ADD CONSTRAINT `FK_android_devices_proxy` FOREIGN KEY (`proxy_id`) REFERENCES `device_proxies`(`id`) ON DELETE SET NULL',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const devices = await queryRunner.getTable('android_devices');
    if (devices && devices.findColumnByName('proxy_id')) {
      await queryRunner.query('ALTER TABLE `android_devices` DROP FOREIGN KEY `FK_android_devices_proxy`');
      await queryRunner.query('ALTER TABLE `android_devices` DROP COLUMN `proxy_id`');
    }
    if (await queryRunner.hasTable('device_proxies')) {
      await queryRunner.query('DROP TABLE `device_proxies`');
    }
  }
}
