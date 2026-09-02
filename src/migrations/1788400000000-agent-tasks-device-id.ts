import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentTasksDeviceId1788400000000 implements MigrationInterface {
  name = 'AgentTasksDeviceId1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('agent_tasks');
    if (table && !table.findColumnByName('device_id')) {
      await queryRunner.query(`ALTER TABLE \`agent_tasks\` ADD COLUMN \`device_id\` int NULL`);
      await queryRunner.query(`CREATE INDEX \`IDX_agent_tasks_device_id\` ON \`agent_tasks\` (\`device_id\`)`);
    }

    // Backfill device_id for existing tasks from their step logs.
    await queryRunner.query(`
      UPDATE \`agent_tasks\` t
      SET t.\`device_id\` = (
        SELECT l.\`device_id\`
        FROM \`android_task_logs\` l
        WHERE l.\`agent_task_id\` = t.\`id\` AND l.\`device_id\` IS NOT NULL
        ORDER BY l.\`step_index\` ASC
        LIMIT 1
      )
      WHERE t.\`device_id\` IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('agent_tasks');
    if (table && table.findColumnByName('device_id')) {
      await queryRunner.query(`DROP INDEX \`IDX_agent_tasks_device_id\` ON \`agent_tasks\``);
      await queryRunner.query(`ALTER TABLE \`agent_tasks\` DROP COLUMN \`device_id\``);
    }
  }
}
