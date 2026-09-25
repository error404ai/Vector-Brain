import { MigrationInterface, QueryRunner } from 'typeorm';

/** Screenshots captured for the public landing page (phones and app pages). */
export class LandingShots1791400000000 implements MigrationInterface {
  name = 'LandingShots1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`landing_shots\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`kind\` varchar(8) NOT NULL,
        \`source\` varchar(10) NOT NULL,
        \`device_id\` int NULL,
        \`label\` varchar(150) NOT NULL,
        \`device_model\` varchar(100) NULL,
        \`mission_id\` int NULL,
        \`mime\` varchar(12) NOT NULL,
        \`width\` int NOT NULL DEFAULT 0,
        \`height\` int NOT NULL DEFAULT 0,
        \`size_bytes\` int NOT NULL DEFAULT 0,
        \`image\` mediumblob NOT NULL,
        \`slot\` varchar(12) NULL,
        \`approved\` tinyint NOT NULL DEFAULT 0,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_landing_shot_slot\` (\`approved\`, \`slot\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `landing_shots`');
  }
}
