import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeviceTag1789700000000 implements MigrationInterface {
  name = 'DeviceTag1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('android_devices');
    if (table && !table.findColumnByName('tag')) {
      await queryRunner.query('ALTER TABLE `android_devices` ADD `tag` varchar(40) NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('android_devices');
    if (table && table.findColumnByName('tag')) {
      await queryRunner.query('ALTER TABLE `android_devices` DROP COLUMN `tag`');
    }
  }
}
