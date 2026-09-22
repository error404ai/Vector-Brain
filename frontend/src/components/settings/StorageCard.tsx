import { useGetDbSpaceQuery } from '@/RTKService/androidService/androidService';
import StorageIcon from '@mui/icons-material/Storage';
import { Box, Card, CardContent, LinearProgress, Stack, Typography } from '@mui/material';

/**
 * What the database is holding, and which tables are holding it.
 *
 * Run history, screen dumps and pushed files grow quietly, and the only way to
 * clear space safely is to know which of them is actually large. The numbers
 * come straight from the server; nothing here deletes anything.
 */
export default function StorageCard() {
  const { data, isLoading } = useGetDbSpaceQuery();
  const report = data?.data;

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1.5 }}>
          <StorageIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Storage
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {report && (
            <Typography variant="body2" color="text.secondary">
              {report.total_mb} MB used
            </Typography>
          )}
        </Stack>

        {isLoading && <LinearProgress sx={{ borderRadius: 2 }} />}

        {report && (
          <>
            <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: 2 }}>
              <Stat label="Runs kept" value={report.counts.tasks} />
              <Stat label="Older than 30 days" value={report.counts.tasks_over_30d} />
              <Stat label="Shared runs" value={report.counts.tasks_shared} />
              <Stat label="Step logs" value={report.counts.task_logs} />
              <Stat label="Shared frames" value={report.counts.shared_frames} />
              <Stat label="Stored files" value={report.counts.file_blobs} />
            </Stack>

            {report.reclaimable_mb > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {report.reclaimable_mb} MB has already been deleted but not handed back to the disk — MySQL keeps
                that space inside the tables until they are optimised.
              </Typography>
            )}

            {report.step_log_columns && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Inside step logs: UI snapshots {report.step_log_columns.ui_tree_mb ?? 0} MB · reasoning{' '}
                {report.step_log_columns.thought_mb ?? 0} MB · actions {report.step_log_columns.action_mb ?? 0} MB ·
                results {report.step_log_columns.result_mb ?? 0} MB
              </Typography>
            )}

            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              Largest tables
            </Typography>
            <Stack gap={0.5} sx={{ mt: 0.75 }}>
              {report.tables.slice(0, 6).map((table) => {
                const size = table.data_mb + table.index_mb;
                const share = report.total_mb > 0 ? Math.min(100, (size / report.total_mb) * 100) : 0;
                return (
                  <Box key={table.table_name}>
                    <Stack direction="row" gap={1}>
                      <Typography variant="caption" sx={{ flexGrow: 1 }} noWrap>
                        {table.table_name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {size.toFixed(1)} MB · {table.rows.toLocaleString()} rows
                      </Typography>
                    </Stack>
                    <LinearProgress variant="determinate" value={share} sx={{ height: 4, borderRadius: 2 }} />
                  </Box>
                );
              })}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
        {(value ?? 0).toLocaleString()}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
