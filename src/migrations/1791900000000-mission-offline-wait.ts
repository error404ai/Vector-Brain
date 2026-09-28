import { MigrationInterface, QueryRunner } from 'typeorm';

/** When a mission's phone went offline: the mission waits for it to reconnect instead of burning its retries. */
export class MissionOfflineWait1791900000000 implements MigrationInterface {
  name = 'MissionOfflineWait1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('mission_items', 'waiting_since'))) {
      await queryRunner.query('ALTER TABLE `mission_items` ADD COLUMN `waiting_since` datetime NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('mission_items', 'waiting_since')) await queryRunner.query('ALTER TABLE `mission_items` DROP COLUMN `waiting_since`');
  }
}
