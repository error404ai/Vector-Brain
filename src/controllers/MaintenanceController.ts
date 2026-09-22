import { AppDataSource } from '@/loaders/database';
import { Authorized, Get, JsonController } from 'routing-controllers';
import { Service } from 'typedi';

/**
 * Where the database's space is going.
 *
 * Run history, screen dumps and pushed files all grow quietly, and guessing
 * which one is the problem leads to deleting the wrong thing. This reports
 * sizes and row counts only — it reads nothing out of the rows themselves and
 * changes nothing.
 */
@Service()
@JsonController('/maintenance')
export class MaintenanceController {
  @Authorized()
  @Get('/db-space')
  async dbSpace() {
    const tables: {
      table_name: string;
      rows: number;
      data_mb: number;
      index_mb: number;
      free_mb: number;
    }[] = (
      await AppDataSource.query(`
        SELECT table_name AS table_name,
               table_rows AS row_count,
               ROUND(data_length / 1048576, 1) AS data_mb,
               ROUND(index_length / 1048576, 1) AS index_mb,
               ROUND(data_free / 1048576, 1) AS free_mb
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        ORDER BY (data_length + index_length) DESC
        LIMIT 25
      `)
    ).map((row: Record<string, unknown>) => ({
      table_name: String(row.table_name),
      rows: Number(row.row_count ?? 0),
      data_mb: Number(row.data_mb ?? 0),
      index_mb: Number(row.index_mb ?? 0),
      free_mb: Number(row.free_mb ?? 0),
    }));

    // What is old enough that nothing would miss it, and what is pinned by a
    // share link or a saved flow (which the history sweep deliberately keeps).
    const [detail] = await AppDataSource.query(`
      SELECT
        (SELECT COUNT(*) FROM agent_tasks) AS tasks,
        (SELECT COUNT(*) FROM agent_tasks WHERE created_at < NOW() - INTERVAL 30 DAY) AS tasks_over_30d,
        (SELECT COUNT(*) FROM agent_tasks WHERE share_token IS NOT NULL) AS tasks_shared,
        (SELECT COUNT(*) FROM android_task_logs) AS task_logs,
        (SELECT COUNT(*) FROM shared_run_frames) AS shared_frames,
        (SELECT COUNT(*) FROM device_file_blobs) AS file_blobs,
        (SELECT COUNT(*) FROM device_file_transfers) AS file_transfers
    `);

    // android_task_logs is usually the big one, and the reason is one column,
    // not the row count — so the report names the column rather than leaving the
    // choice between "delete history" and "keep paying for it".
    const [stepColumns] = await AppDataSource.query(`
      SELECT
        ROUND(SUM(LENGTH(COALESCE(ui_tree_snapshot, ''))) / 1048576, 1) AS ui_tree_mb,
        ROUND(SUM(LENGTH(COALESCE(thought_reasoning, ''))) / 1048576, 1) AS thought_mb,
        ROUND(SUM(LENGTH(COALESCE(action_payload, ''))) / 1048576, 1) AS action_mb,
        ROUND(SUM(LENGTH(COALESCE(result_message, ''))) / 1048576, 1) AS result_mb,
        ROUND(SUM(LENGTH(COALESCE(error_message, ''))) / 1048576, 1) AS error_mb
      FROM android_task_logs
    `);

    const totalMb = tables.reduce((sum, table) => sum + table.data_mb + table.index_mb, 0);
    const freeMb = tables.reduce((sum, table) => sum + table.free_mb, 0);

    return {
      message: 'Database space report',
      data: {
        total_mb: Math.round(totalMb),
        // Space already freed by deletes that MySQL has not returned to the
        // disk: an OPTIMIZE TABLE is what actually hands it back.
        reclaimable_mb: Math.round(freeMb),
        counts: Object.fromEntries(Object.entries(detail ?? {}).map(([key, value]) => [key, Number(value)])),
        step_log_columns: Object.fromEntries(
          Object.entries(stepColumns ?? {}).map(([key, value]) => [key, Number(value ?? 0)]),
        ),
        tables,
      },
    };
  }
}
