import { MigrationInterface, QueryRunner } from 'typeorm';

/** Test Lab: per-account settings and one row per nightly run (jobs and report as JSON). */
export class TestLab1792920000000 implements MigrationInterface {
  name = 'TestLab1792920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS `test_lab_configs` (`user_id` int NOT NULL, `settings` json NOT NULL, `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (`user_id`)) ENGINE=InnoDB',
    );
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS `test_lab_nights` (`id` int NOT NULL AUTO_INCREMENT, `user_id` int NOT NULL, `status` varchar(12) NOT NULL DEFAULT \'RUNNING\', `day` varchar(10) NOT NULL, `manual` tinyint NOT NULL DEFAULT 0, `jobs` json NOT NULL, `report` json NULL, `started_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `finished_at` datetime NULL, PRIMARY KEY (`id`), INDEX `IDX_test_lab_nights_user` (`user_id`, `id`)) ENGINE=InnoDB',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `test_lab_nights`');
    await queryRunner.query('DROP TABLE IF EXISTS `test_lab_configs`');
  }
}
