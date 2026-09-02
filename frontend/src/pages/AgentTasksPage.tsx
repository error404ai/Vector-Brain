import type { DataTableColumn } from '@/components/datatable';
import { DataTable } from '@/components/datatable';
import { useAgentTasksDataTable, type AgentTask, type CreateAgentTaskPayload } from '@/hooks/useAgentTasksDataTable';
import { useGetAndroidDevicesQuery } from '@/RTKService/androidService/androidService';
import PageHeader, { HeaderActions } from '@/components/ui/PageHeader';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { Button, Chip, Typography } from '@mui/material';
import { useDisclosure } from '@/components/mui/hooks';
import { modals } from '@/components/mui/modals';
import { notifications } from '@/components/mui/notifications';
import { IconCheck, IconX } from '@/components/mui/icons';

import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AgentTaskActions } from '@/components/agent-tasks/AgentTaskActions';
import { AgentTaskDetailModal } from '@/components/agent-tasks/AgentTaskDetailModal';
import { CreateAgentTaskModal } from '@/components/agent-tasks/CreateAgentTaskModal';

/** Turns a duration in seconds into "1m 12s" style text. */
function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMins = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 24 * 60) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString();
}

/**
 * A task carries more nuance than a success boolean: a run that burned its whole
 * step budget or produced no steps at all is not the same as a clean failure.
 */
function outcomeOf(task: AgentTask): { label: string; color: 'success' | 'error' | 'warning' | 'default' } {
  if (task.success) return { label: 'Succeeded', color: 'success' };
  const message = (task.message || '').toLowerCase();
  if (message.includes('cancelled')) return { label: 'Cancelled', color: 'default' };
  if (message.includes('step limit') || message.includes('-step limit')) return { label: 'Step limit', color: 'warning' };
  if (task.total_steps === 0) return { label: 'Never started', color: 'error' };
  return { label: 'Failed', color: 'error' };
}

export default function AgentTasks() {
  // Get agent tasks data and handlers from custom hook
  const { data: agentTasks, pagination, isLoading, isCreating, isDeleting, page, limit, search, setPage, setLimit, setSearch, handleSortChange, handleCreateAgentTask, handleDeleteAgentTask } = useAgentTasksDataTable();

  const { data: devicesData } = useGetAndroidDevicesQuery();
  const deviceNames = useMemo(() => {
    const map: Record<number, string> = {};
    for (const device of devicesData?.data ?? []) map[device.id] = device.device_name;
    return map;
  }, [devicesData]);

  // Row selection state
  const [selectedTasks, setSelectedTasks] = useState<AgentTask[]>([]);

  // View task state
  const [viewingTask, setViewingTask] = useState<AgentTask | undefined>();

  // Modal states
  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure(false);
  const [detailModalOpened, { open: openDetailModal, close: closeDetailModal }] = useDisclosure(false);

  // Handlers
  const handleViewTask = (task: AgentTask) => {
    setViewingTask(task);
    openDetailModal();
  };

  const handleCloseDetailModal = () => {
    setViewingTask(undefined);
    closeDetailModal();
  };

  const handleCreateSubmit = async (data: CreateAgentTaskPayload) => {
    await handleCreateAgentTask(data);
    notifications.show({
      title: 'Success',
      message: 'Agent task created successfully',
      color: 'green',
      icon: <IconCheck size="1rem" />,
    });
    closeCreateModal();
  };

  const handleBulkDelete = () => {
    if (selectedTasks.length === 0) return;

    modals.openConfirmModal({
      title: 'Delete Agent Tasks',
      children: `Are you sure you want to delete ${selectedTasks.length} task(s)? This action cannot be undone.`,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          // Delete tasks one by one
          await Promise.all(selectedTasks.map((task) => handleDeleteAgentTask(task.id)));
          setSelectedTasks([]);
          notifications.show({
            title: 'Success',
            message: `${selectedTasks.length} task(s) deleted successfully`,
            color: 'green',
            icon: <IconCheck size="1rem" />,
          });
        } catch (error) {
          notifications.show({
            title: 'Error',
            message: error instanceof Error ? error.message : 'Failed to delete tasks',
            color: 'red',
            icon: <IconX size="1rem" />,
          });
        }
      },
    });
  };

  // Column definitions
  const columns: DataTableColumn<AgentTask>[] = [
    {
      accessor: 'id',
      title: 'ID',
      width: 80,
      sortable: true,
    },
    {
      accessor: 'prompt',
      title: 'Prompt',
      sortable: true,
      render: (task) => (
        <Typography variant="body2" sx={{ maxWidth: 440, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {task.prompt}
        </Typography>
      ),
    },
    {
      accessor: 'device_id',
      title: 'Device',
      sortable: false,
      render: (task) => (
        <Typography variant="body2" color={task.device_id ? 'text.primary' : 'text.secondary'} noWrap>
          {task.device_id ? deviceNames[task.device_id] ?? `Device ${task.device_id}` : '—'}
        </Typography>
      ),
    },
    {
      accessor: 'success',
      title: 'Outcome',
      sortable: true,
      render: (task) => {
        const outcome = outcomeOf(task);
        return <Chip label={outcome.label} size="small" color={outcome.color} variant="outlined" sx={{ fontWeight: 700 }} />;
      },
    },
    {
      accessor: 'total_steps',
      title: 'Steps',
      sortable: true,
      width: 90,
      render: (task) => <Typography variant="body2">{task.total_steps}</Typography>,
    },
    {
      accessor: 'total_duration_seconds',
      title: 'Duration',
      sortable: true,
      width: 110,
      render: (task) => <Typography variant="body2">{formatDuration(task.total_duration_seconds)}</Typography>,
    },
    {
      accessor: 'model',
      title: 'Model',
      sortable: true,
      render: (task) => (
        <Typography variant="body2" color={task.model ? 'text.primary' : 'text.secondary'} noWrap>
          {task.model || 'N/A'}
        </Typography>
      ),
    },
    {
      accessor: 'created_at',
      title: 'Started',
      sortable: true,
      width: 130,
      render: (task) => (
        <Typography variant="body2" title={new Date(task.created_at).toLocaleString()}>
          {formatWhen(task.created_at)}
        </Typography>
      ),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      textAlign: 'center',
      sortable: false,
      render: (task) => <AgentTaskActions task={task} onView={handleViewTask} onDelete={handleDeleteAgentTask} isDeleting={isDeleting} />,
    },
  ];

  return (
    <>
      <Helmet>
        <title>Agent Tasks - Vector Brain</title>
      </Helmet>
      <PageHeader
        title="Agent Tasks"
        subtitle="Manage AI agent tasks and their execution logs."
        action={
          <HeaderActions>
            {selectedTasks.length > 0 && (
              <Button variant="outlined" color="error" onClick={handleBulkDelete} disabled={isDeleting} startIcon={<DeleteIcon />}>
                Delete Selected ({selectedTasks.length})
              </Button>
            )}
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateModal}>
              New Task
            </Button>
          </HeaderActions>
        }
      />

      <DataTable<AgentTask>
        columns={columns}
        data={agentTasks}
        loading={isLoading}
        withTableBorder
        striped
        highlightOnHover
        withRowSelection
        selectedRecords={selectedTasks}
        onSelectionChange={setSelectedTasks}
        sortable
        onSortStatusChange={handleSortChange}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search tasks by prompt..."
        pagination
        page={pagination?.currentPage ?? page}
        recordsPerPage={pagination?.pageSize ?? limit}
        totalRecords={pagination?.totalCount ?? 0}
        totalPages={pagination?.totalPages}
        onPageChange={setPage}
        onRecordsPerPageChange={setLimit}
        recordsPerPageOptions={[5, 10, 20, 50]}
        noRecordsText="No agent tasks found"
        loadingText="Loading agent tasks..."
        minHeight={300}
        verticalSpacing="sm"
      />

      <CreateAgentTaskModal opened={createModalOpened} onClose={closeCreateModal} onSubmit={handleCreateSubmit} isLoading={isCreating} />

      <AgentTaskDetailModal task={viewingTask} opened={detailModalOpened} onClose={handleCloseDetailModal} />
    </>
  );
}
