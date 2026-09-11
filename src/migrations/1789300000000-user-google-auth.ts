import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserGoogleAuth1789300000000 implements MigrationInterface {
  name = 'UserGoogleAuth1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    if (!table) return;

    if (!table.findColumnByName('google_id')) {
      await queryRunner.query(
        'ALTER TABLE `users` ADD `google_id` varchar(64) NULL, ADD UNIQUE INDEX `IDX_users_google_id` (`google_id`)',
      );
    }
    if (!table.findColumnByName('avatar_url')) {
      await queryRunner.query('ALTER TABLE `users` ADD `avatar_url` varchar(500) NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    if (!table) return;

    if (table.findColumnByName('google_id')) {
      await queryRunner.query('ALTER TABLE `users` DROP INDEX `IDX_users_google_id`, DROP COLUMN `google_id`');
    }
    if (table.findColumnByName('avatar_url')) {
      await queryRunner.query('ALTER TABLE `users` DROP COLUMN `avatar_url`');
    }
  }
}
