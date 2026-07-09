import type { DataTableColumn } from '@/components/datatable';
import { DataTable } from '@/components/datatable';
import { useAgentTasksDataTable, type AgentTask, type CreateAgentTaskPayload } from '@/hooks/useAgentTasksDataTable';
import PageHeader, { HeaderActions } from '@/components/ui/PageHeader';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { Button, Chip, Typography } from '@mui/material';
import { useDisclosure } from '@/components/mui/hooks';
import { modals } from '@/components/mui/modals';
import { notifications } from '@/components/mui/notifications';
import { IconCheck, IconX } from '@/components/mui/icons';

import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AgentTaskActions } from '@/components/agent-tasks/AgentTaskActions';
import { AgentTaskDetailModal } from '@/components/agent-tasks/AgentTaskDetailModal';
import { CreateAgentTaskModal } from '@/components/agent-tasks/CreateAgentTaskModal';

export default function AgentTasks() {
  // Get agent tasks data and handlers from custom hook
  const { data: agentTasks, pagination, isLoading, isCreating, isDeleting, page, limit, search, setPage, setLimit, setSearch, handleSortChange, handleCreateAgentTask, handleDeleteAgentTask } = useAgentTasksDataTable();

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
      accessor: 'steps',
      title: 'Steps',
      sortable: false,
      render: (task) => (
        <Typography variant="body2" color={task.steps ? 'text.primary' : 'text.secondary'}>
          {task.steps ? `${task.steps.substring(0, 50)}...` : 'No steps'}
        </Typography>
      ),
    },
    {
      accessor: 'logs',
      title: 'Logs',
      sortable: false,
      render: (task) => (
        <Typography variant="body2" color={task.logs ? 'text.primary' : 'text.secondary'}>
          {task.logs ? `${task.logs.substring(0, 50)}...` : 'No logs'}
        </Typography>
      ),
    },
    {
      accessor: 'provider',
      title: 'Provider',
      sortable: true,
      render: (task) => (
        <Typography variant="body2" color={task.provider ? 'text.primary' : 'text.secondary'}>
          {task.provider || 'N/A'}
        </Typography>
      ),
    },
    {
      accessor: 'model',
      title: 'Model',
      sortable: true,
      render: (task) => (
        <Typography variant="body2" color={task.model ? 'text.primary' : 'text.secondary'}>
          {task.model || 'N/A'}
        </Typography>
      ),
    },
    {
      accessor: 'success',
      title: 'Success',
      sortable: true,
      render: (task) => <Chip label={task.success ? 'Yes' : 'No'} size="small" color={task.success ? 'success' : 'error'} variant="outlined" />,
    },
    {
      accessor: 'total_steps',
      title: 'Total Steps',
      sortable: true,
      render: (task) => <Typography variant="body2">{task.total_steps}</Typography>,
    },
    {
      accessor: 'total_duration_seconds',
      title: 'Duration (s)',
      sortable: true,
      render: (task) => <Typography variant="body2">{task.total_duration_seconds.toFixed(2)}</Typography>,
    },
    {
      accessor: 'created_at',
      title: 'Created',
      sortable: true,
      render: (task) => <Typography variant="body2">{new Date(task.created_at).toLocaleDateString()}</Typography>,
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
