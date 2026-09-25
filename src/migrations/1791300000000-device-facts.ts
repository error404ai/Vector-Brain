import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-phone facts (the email accounts on each phone), filled by runs or the user. */
export class DeviceFacts1791300000000 implements MigrationInterface {
  name = 'DeviceFacts1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`device_facts\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`device_id\` int NOT NULL,
        \`fact_key\` varchar(40) NOT NULL,
        \`value\` text NOT NULL,
        \`source\` varchar(8) NOT NULL DEFAULT 'ai',
        \`mission_id\` int NULL,
        \`suggested\` text NULL,
        \`suggested_mission_id\` int NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_device_fact_key\` (\`device_id\`, \`fact_key\`),
        INDEX \`IDX_device_fact_user\` (\`user_id\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `device_facts`');
  }
}
