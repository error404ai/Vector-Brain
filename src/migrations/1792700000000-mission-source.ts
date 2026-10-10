import { MigrationInterface, QueryRunner } from 'typeorm';

/** missions.source: "testset:<run>" for missions started by a test-set run. */
export class MissionSource1792700000000 implements MigrationInterface {
  name = 'MissionSource1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('missions', 'source'))) {
      await queryRunner.query('ALTER TABLE `missions` ADD COLUMN `source` varchar(40) NULL');
      await queryRunner.query('CREATE INDEX `IDX_missions_source` ON `missions` (`source`)');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('missions', 'source')) {
      await queryRunner.query('DROP INDEX `IDX_missions_source` ON `missions`');
      await queryRunner.query('ALTER TABLE `missions` DROP COLUMN `source`');
    }
  }
}
