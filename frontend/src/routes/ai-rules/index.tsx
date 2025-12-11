/* eslint-disable @typescript-eslint/no-unused-vars */
import type { DataTableColumn } from '@/components/datatable';
import { DataTable } from '@/components/datatable';
import { useAiRulesDataTable, type AiRule, type CreateAiRulePayload, type UpdateAiRulePayload } from '@/hooks/useAiRulesDataTable';
import { Box, Button, Group, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPlus, IconX } from '@tabler/icons-react';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AiRuleActions } from './_partials/AiRuleActions';
import { AiRuleDetailModal } from './_partials/AiRuleDetailModal';
import { AiRuleFormModal } from './_partials/AiRuleFormModal';

export const Route = createFileRoute('/ai-rules/')({
  component: AiRules,
});

function AiRules() {
  // Get AI rules data and handlers from custom hook
  const { data: aiRules, pagination, isLoading, isCreating, isUpdating, page, limit, search, setPage, setLimit, setSearch, handleSortChange, handleCreateAiRule, handleUpdateAiRule, handleDeleteAiRule } = useAiRulesDataTable();

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
        message: 'AI rule updated successfully',
        color: 'green',
        icon: <IconCheck size={16} />,
      });
    } else {
      await handleCreateAiRule(data as CreateAiRulePayload);
      notifications.show({
        title: 'Success',
        message: 'AI rule created successfully',
        color: 'green',
        icon: <IconCheck size={16} />,
      });
    }
    closeFormModal();
  };

  const handleDeleteRule = async (rule: AiRule) => {
    modals.openConfirmModal({
      title: 'Delete AI Rule',
      children: <Text size="sm">Are you sure you want to delete the AI rule "{rule.name}"? This action cannot be undone.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await handleDeleteAiRule(rule.id);
          notifications.show({
            title: 'Success',
            message: 'AI rule deleted successfully',
            color: 'green',
            icon: <IconCheck size={16} />,
          });
        } catch (error) {
          notifications.show({
            title: 'Error',
            message: 'Failed to delete AI rule',
            color: 'red',
            icon: <IconX size={16} />,
          });
        }
      },
    });
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
      accessor: 'description',
      title: 'Description',
      render: (rule) => rule.description || '-',
    },
    {
      accessor: 'is_active',
      title: 'Active',
      render: (rule) => (rule.is_active ? 'Yes' : 'No'),
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
      render: (rule) => <AiRuleActions rule={rule} onView={handleViewRule} onEdit={handleEditRule} onDelete={handleDeleteRule} />,
    },
  ];

  return (
    <>
      <Helmet>
        <title>AI Rules - Vector Brain</title>
      </Helmet>

      <Box p="md">
        <Group justify="space-between" mb="md">
          <div>
            <Title order={2}>AI Rules</Title>
            <Text c="dimmed">Manage AI rules for your agent tasks</Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={handleCreateRule} loading={isCreating}>
            Create AI Rule
          </Button>
        </Group>

        <DataTable
          data={aiRules}
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
          searchPlaceholder="Search AI rules..."
          sortable
          onSortStatusChange={handleSortChange}
          noRecordsText="No AI rules found"
          loadingText="Loading AI rules..."
          minHeight={300}
          verticalSpacing="sm"
        />
      </Box>

      {/* Modals */}
      <AiRuleFormModal opened={formModalOpened} onClose={handleCloseFormModal} onSubmit={handleFormSubmit} rule={editingRule} loading={isCreating || isUpdating} />

      <AiRuleDetailModal opened={detailModalOpened} onClose={handleCloseDetailModal} rule={viewingRule} />
    </>
  );
}
