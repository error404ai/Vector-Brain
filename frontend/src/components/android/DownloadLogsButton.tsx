import { useLazyGetAndroidTaskLogsQuery } from '@/RTKService/androidService/androidService';
import DownloadIcon from '@mui/icons-material/Download';
import { Button, ListItemText, Menu, MenuItem } from '@mui/material';
import { useState } from 'react';
import toast from 'react-hot-toast';

interface DownloadLogsButtonProps {
  taskId: number;
}

/**
 * Exports every step of a run to a file.
 *
 * The conversation panel only ever shows the last few actions — a long run
 * reports "25 earlier actions not shown" — so there is no way to review what
 * actually happened from the UI alone. The data was already being stored and
 * already had an endpoint; it just had no way out.
 *
 * ui_tree_snapshot is deliberately dropped from both formats. It is the single
 * largest column in the table and a single run's trees run to megabytes, which
 * would make the download useless to open.
 */
export default function DownloadLogsButton({ taskId }: DownloadLogsButtonProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [fetchLogs, { isFetching }] = useLazyGetAndroidTaskLogsQuery();

  const save = (content: string, extension: string) => {
    const blob = new Blob([content], { type: extension === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vector-brain-run-${taskId}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownload = async (format: 'json' | 'txt') => {
    setAnchorEl(null);
    try {
      const result = await fetchLogs(taskId).unwrap();
      const logs = result.data ?? [];
      const task = result.task;

      if (format === 'json') {
        save(
          JSON.stringify(
            {
              task,
              steps: logs.map(({ ui_tree_snapshot: _ignored, ...step }) => step),
            },
            null,
            2,
          ),
          'json',
        );
        return;
      }

      const lines: string[] = [
        `Vector Brain run #${taskId}`,
        `Prompt: ${task?.prompt ?? ''}`,
        `Result: ${task?.success ? 'success' : 'failed'} · ${task?.total_steps ?? logs.length} steps`,
        task?.message ? `Message: ${task.message}` : '',
        `Exported: ${new Date().toISOString()}`,
        '',
        '='.repeat(60),
        '',
      ].filter(Boolean);

      for (const step of logs) {
        lines.push(`STEP ${step.step_index} — ${step.action_type} [${step.status}]`);
        if (step.thought_reasoning) lines.push(`  thought: ${step.thought_reasoning}`);
        if (step.action_payload) lines.push(`  payload: ${JSON.stringify(step.action_payload)}`);
        if (step.result_message) lines.push(`  result: ${step.result_message}`);
        if (step.error_message) lines.push(`  error: ${step.error_message}`);
        if (step.duration_ms) lines.push(`  took: ${step.duration_ms} ms`);
        lines.push('');
      }

      save(lines.join('\n'), 'txt');
    } catch {
      toast.error('Could not load the logs for this run');
    }
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<DownloadIcon />}
        disabled={isFetching}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{ borderRadius: 2, fontWeight: 700 }}
      >
        {isFetching ? 'Preparing…' : 'Download logs'}
      </Button>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => handleDownload('txt')}>
          <ListItemText primary="Text (.txt)" secondary="Readable — good for sharing or reporting a problem" />
        </MenuItem>
        <MenuItem onClick={() => handleDownload('json')}>
          <ListItemText primary="JSON (.json)" secondary="Every field, for tooling" />
        </MenuItem>
      </Menu>
    </>
  );
}
