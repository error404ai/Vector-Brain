/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataTableColumn } from '@/components/datatable';
import { DataTable } from '@/components/datatable';
import { useMyRulesDataTable, type AiRule, type CreateAiRulePayload, type UpdateAiRulePayload } from '@/hooks/useMyRulesDataTable';
import { Badge, Box, Button, Group, Stack, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPlus, IconX } from '@tabler/icons-react';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MyRuleActions } from './_partials/-MyRuleActions';
import { MyRuleDetailModal } from './_partials/-MyRuleDetailModal';
import { MyRuleFormModal } from './_partials/-MyRuleFormModal';

const getApiErrorMessage = (error: unknown, fallback: string) => {
  const apiError = error as { data?: { message?: string }; message?: string };
  return apiError?.data?.message || apiError?.message || fallback;
};

export const Route = createFileRoute('/my-rules/')({
  component: MyRules,
});

function MyRules() {
  // Get My Rules data and handlers from custom hook
  const {
    data: myRules,
    pagination,
    isLoading,
    isCreating,
    isUpdating,
    page,
    limit,
    search,
    setPage,
    setLimit,
    setSearch,
    handleSortChange,
    handleCreateAiRule,
    handleUpdateAiRule,
    handleDeleteAiRule,
    handleVectorizeAiRule,
  } = useMyRulesDataTable();

  // View rule state
  const [viewingRule, setViewingRule] = useState<AiRule | undefined>();

  // Edit rule state
  const [editingRule, setEditingRule] = useState<AiRule | undefined>();

  // Modal states
  const [formModalOpened, { open: openFormModal, close: closeFormModal }] = useDisclosure(false);
  const [detailModalOpened, { open: openDetailModal, close: closeDetailModal }] = useDisclosure(false);

  // Handlers
  const handleViewRule = (rule: AiRule) => {
    setViewingRule(rule);
    openDetailModal();
  };

  const handleCloseDetailModal = () => {
    setViewingRule(undefined);
    closeDetailModal();
  };

  const handleCreateRule = () => {
    setEditingRule(undefined);
    openFormModal();
  };

  const handleEditRule = (rule: AiRule) => {
    setEditingRule(rule);
    openFormModal();
  };

  const handleCloseFormModal = () => {
    setEditingRule(undefined);
    closeFormModal();
  };

  const handleFormSubmit = async (data: CreateAiRulePayload | UpdateAiRulePayload) => {
    if (editingRule) {
      await handleUpdateAiRule(editingRule.id, data as UpdateAiRulePayload);
      notifications.show({
        title: 'Success',
        message: 'Rule updated successfully',
        color: 'green',
        icon: <IconCheck size={16} />,
      });
    } else {
      await handleCreateAiRule(data as CreateAiRulePayload);
      notifications.show({
        title: 'Success',
        message: 'Rule created successfully',
        color: 'green',
        icon: <IconCheck size={16} />,
      });
    }
    closeFormModal();
  };

  const handleDeleteRule = async (rule: AiRule) => {
    modals.openConfirmModal({
      title: 'Delete Rule',
      children: <Text size="sm">Are you sure you want to delete the rule "{rule.name}"? This action cannot be undone.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await handleDeleteAiRule(rule.id);
          notifications.show({
            title: 'Success',
            message: 'Rule deleted successfully',
            color: 'green',
            icon: <IconCheck size={16} />,
          });
        } catch (error) {
          notifications.show({
            title: 'Error',
            message: 'Failed to delete rule',
            color: 'red',
            icon: <IconX size={16} />,
          });
        }
      },
    });
  };

  // Handle vectorize single rule
  const handleVectorize = async (rule: AiRule) => {
    try {
      await handleVectorizeAiRule(rule.id);
      notifications.show({
        title: 'Vectorization Complete',
        message: `Rule "${rule.name}" has been vectorized`,
        color: 'green',
        icon: <IconCheck size={16} />,
      });
    } catch (error) {
      notifications.show({
        title: 'Vectorization Error',
        message: getApiErrorMessage(error, 'Failed to vectorize the rule'),
        color: 'red',
        icon: <IconX size={16} />,
      });
    }
  };

  // Define table columns
  const columns: DataTableColumn<AiRule>[] = [
    {
      accessor: 'id',
      title: 'ID',
      sortable: true,
      width: 80,
    },
    {
      accessor: 'name',
      title: 'Name',
      sortable: true,
    },
    {
      accessor: 'intent',
      title: 'Intent',
      render: (rule) => (
        <Text size="sm" lineClamp={2} title={rule.intent}>
          {rule.intent}
        </Text>
      ),
    },
    {
      accessor: 'website',
      title: 'Website',
      render: (rule) => rule.website || 'N/A',
      sortable: true,
    },
    {
      accessor: 'is_active',
      title: 'Active',
      render: (rule) => (rule.is_active ? 'Yes' : 'No'),
      width: 100,
    },
    {
      accessor: 'vector_exist',
      title: 'Vectorized',
      render: (rule) => (
        <Badge color={rule.vector_exist ? 'green' : 'red'} variant="light">
          {rule.vector_exist ? 'Yes' : 'No'}
        </Badge>
      ),
      width: 100,
    },
    {
      accessor: 'created_at',
      title: 'Created',
      render: (rule) => new Date(rule.created_at).toLocaleDateString(),
      sortable: true,
      width: 120,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 120,
      render: (rule) => <MyRuleActions rule={rule} onView={handleViewRule} onEdit={handleEditRule} onDelete={handleDeleteRule} onVectorize={handleVectorize} />,
    },
  ];

  return (
    <>
      <Helmet>
        <title>My Rules - Vector Brain</title>
      </Helmet>

      <Box p="md">
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Title order={2}>My Rules</Title>
              <Text c="dimmed">Create and manage your personal AI rules. These rules will be prioritized when searching.</Text>
            </div>
            <Button leftSection={<IconPlus size={16} />} onClick={handleCreateRule} loading={isCreating}>
              Create Rule
            </Button>
          </Group>

          <DataTable
            data={myRules}
            columns={columns}
            loading={isLoading}
            pagination
            page={pagination?.currentPage ?? page}
            recordsPerPage={pagination?.pageSize ?? limit}
            totalRecords={pagination?.totalCount ?? 0}
            totalPages={pagination?.totalPages}
            onPageChange={setPage}
            onRecordsPerPageChange={setLimit}
            recordsPerPageOptions={[5, 10, 20, 50]}
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search my rules..."
            sortable
            onSortStatusChange={handleSortChange}
            noRecordsText="You haven't created any rules yet. Click 'Create Rule' to get started."
            loadingText="Loading your rules..."
            minHeight={300}
            verticalSpacing="sm"
          />
        </Stack>
      </Box>

      {/* Modals */}
      <MyRuleFormModal opened={formModalOpened} onClose={handleCloseFormModal} onSubmit={handleFormSubmit} rule={editingRule} loading={isCreating || isUpdating} />

      <MyRuleDetailModal opened={detailModalOpened} onClose={handleCloseDetailModal} rule={viewingRule} />
    </>
  );
}
