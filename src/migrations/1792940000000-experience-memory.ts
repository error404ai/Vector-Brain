import { MigrationInterface, QueryRunner } from 'typeorm';

/** Experience memory: lessons per site or app, what each run used and learned, and the account's switches. */
export class ExperienceMemory1792940000000 implements MigrationInterface {
  name = 'ExperienceMemory1792940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TABLE IF NOT EXISTS `experience_lessons` (`id` int NOT NULL AUTO_INCREMENT, `user_id` int NOT NULL, `scope` varchar(150) NOT NULL, `kind` varchar(12) NOT NULL, `text` varchar(300) NOT NULL, `status` varchar(12) NOT NULL DEFAULT 'candidate', `source` varchar(8) NOT NULL DEFAULT 'auto', `avoid_url` varchar(300) NULL, `helped` int NOT NULL DEFAULT 0, `hurt` int NOT NULL DEFAULT 0, `uses` int NOT NULL DEFAULT 0, `evidence` json NULL, `off_reason` varchar(200) NULL, `last_used_at` datetime NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`), INDEX `IDX_experience_user_scope` (`user_id`, `scope`)) ENGINE=InnoDB",
    );
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS `experience_runs` (`task_id` int NOT NULL, `user_id` int NOT NULL, `succeeded` tinyint NOT NULL DEFAULT 0, `used` json NULL, `learned` json NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`task_id`), INDEX `IDX_experience_runs_user` (`user_id`, `created_at`)) ENGINE=InnoDB',
    );
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS `experience_settings` (`user_id` int NOT NULL, `enabled` tinyint NOT NULL DEFAULT 1, `learn` tinyint NOT NULL DEFAULT 1, PRIMARY KEY (`user_id`)) ENGINE=InnoDB',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `experience_settings`');
    await queryRunner.query('DROP TABLE IF EXISTS `experience_runs`');
    await queryRunner.query('DROP TABLE IF EXISTS `experience_lessons`');
  }
}
