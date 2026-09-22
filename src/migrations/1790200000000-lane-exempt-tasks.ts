import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marks runs that do not need the proxy's exit IP.
 *
 * A proxy lane exists so two phones never share one address while browsing.
 * Changing a setting or working inside an app uses no address at all, yet such
 * runs still waited their turn — and the only way round it was to unassign the
 * proxy, which then has to be put back. This flag lets those runs start at once
 * without holding the lane or rotating anything.
 */
export class LaneExemptTasks1790200000000 implements MigrationInterface {
  name = 'LaneExemptTasks1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `agent_tasks` ADD COLUMN `lane_exempt` tinyint NOT NULL DEFAULT 0 COMMENT 'Run does not use the proxy lane'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `agent_tasks` DROP COLUMN `lane_exempt`');
  }
}
