import { MigrationInterface, QueryRunner } from 'typeorm';

/** Browser-side failure reports (see ClientReport). */
export class ClientReports1791700000000 implements MigrationInterface {
  name = 'ClientReports1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`client_reports\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NULL,
        \`kind\` varchar(32) NOT NULL,
        \`page\` varchar(200) NULL,
        \`tab_id\` varchar(40) NULL,
        \`user_agent\` varchar(300) NULL,
        \`app_version\` varchar(40) NULL,
        \`payload\` json NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_client_reports_created\` (\`created_at\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `client_reports`');
  }
}
