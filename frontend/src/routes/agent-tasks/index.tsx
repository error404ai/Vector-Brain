import type { DataTableColumn } from '@/components/datatable';
import { DataTable } from '@/components/datatable';
import { useAgentTasksDataTable, type AgentTask, type CreateAgentTaskPayload } from '@/hooks/useAgentTasksDataTable';
import { Box, Button, Group, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPlus, IconX } from '@tabler/icons-react';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AgentTaskActions } from './_partials/AgentTaskActions';
import { AgentTaskDetailModal } from './_partials/AgentTaskDetailModal';
import { CreateAgentTaskModal } from './_partials/CreateAgentTaskModal';

export const Route = createFileRoute('/agent-tasks/')({
  component: AgentTasks,
});

function AgentTasks() {
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
        <Text size="sm" lineClamp={2} style={{ maxWidth: 400 }}>
          {task.prompt}
        </Text>
      ),
    },
    {
      accessor: 'steps',
      title: 'Steps',
      sortable: false,
      render: (task) => (
        <Text size="sm" c={task.steps ? 'inherit' : 'dimmed'}>
          {task.steps ? `${task.steps.substring(0, 50)}...` : 'No steps'}
        </Text>
      ),
    },
    {
      accessor: 'logs',
      title: 'Logs',
      sortable: false,
      render: (task) => (
        <Text size="sm" c={task.logs ? 'inherit' : 'dimmed'}>
          {task.logs ? `${task.logs.substring(0, 50)}...` : 'No logs'}
        </Text>
      ),
    },
    {
      accessor: 'created_at',
      title: 'Created',
      sortable: true,
      render: (task) => <Text size="sm">{new Date(task.created_at).toLocaleDateString()}</Text>,
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
    <Box>
      {/* Page Header */}
      <Group justify="space-between" mb="xl">
        <div>
          <Title order={2}>Agent Tasks</Title>
          <Text c="dimmed" size="sm">
            Manage AI agent tasks and their execution logs
          </Text>
        </div>
        <Group>
          {selectedTasks.length > 0 && (
            <Button variant="light" color="red" onClick={handleBulkDelete} loading={isDeleting}>
              Delete Selected ({selectedTasks.length})
            </Button>
          )}
          <Button leftSection={<IconPlus size="1rem" />} onClick={openCreateModal}>
            New Task
          </Button>
        </Group>
      </Group>

      {/* DataTable */}
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

      {/* Create Agent Task Modal */}
      <CreateAgentTaskModal opened={createModalOpened} onClose={closeCreateModal} onSubmit={handleCreateSubmit} isLoading={isCreating} />

      {/* Agent Task Detail Modal */}
      <AgentTaskDetailModal task={viewingTask} opened={detailModalOpened} onClose={handleCloseDetailModal} />
    </Box>
  );
}
