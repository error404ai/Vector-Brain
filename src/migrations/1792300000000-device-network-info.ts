import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per phone: its network and locale as the phone last read them (IPs, DNS, language, timezone…), with a short IP history. */
export class DeviceNetworkInfo1792300000000 implements MigrationInterface {
  name = 'DeviceNetworkInfo1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('android_devices', 'network_info'))) {
      await queryRunner.query('ALTER TABLE `android_devices` ADD COLUMN `network_info` json NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('android_devices', 'network_info')) await queryRunner.query('ALTER TABLE `android_devices` DROP COLUMN `network_info`');
  }
}
