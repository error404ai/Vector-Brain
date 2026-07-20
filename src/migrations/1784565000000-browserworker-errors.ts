import { MigrationInterface, QueryRunner } from 'typeorm';

export class BrowserworkerErrors1784565000000 implements MigrationInterface {
  name = 'BrowserworkerErrors1784565000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`browserworker_errors\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`fingerprint\` char(64) NOT NULL,
        \`error_code\` varchar(100) NOT NULL,
        \`phase\` varchar(80) NOT NULL,
        \`message\` text NOT NULL,
        \`stack\` longtext NULL,
        \`extension_version\` varchar(32) NOT NULL,
        \`browser\` varchar(20) NOT NULL,
        \`browser_version\` varchar(50) NULL,
        \`provider\` varchar(50) NULL,
        \`model\` varchar(100) NULL,
        \`tool\` varchar(100) NULL,
        \`step\` int NULL,
        \`task_duration_ms\` int NULL,
        \`occurrence_count\` int UNSIGNED NOT NULL DEFAULT 1,
        \`first_seen_at\` datetime(6) NOT NULL,
        \`last_seen_at\` datetime(6) NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_browserworker_errors_fingerprint\` (\`fingerprint\`),
        INDEX \`IDX_browserworker_errors_last_seen\` (\`last_seen_at\`),
        INDEX \`IDX_browserworker_errors_code\` (\`error_code\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `browserworker_errors`');
  }
}
