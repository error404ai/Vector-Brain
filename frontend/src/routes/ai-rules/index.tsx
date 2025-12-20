/* eslint-disable @typescript-eslint/no-unused-vars */
import type { DataTableColumn } from '@/components/datatable';
import { DataTable } from '@/components/datatable';
import { useAiRulesDataTable, type AiRule, type CreateAiRulePayload, type UpdateAiRulePayload } from '@/hooks/useAiRulesDataTable';
import { Badge, Box, Button, Card, Group, Progress, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconDatabase, IconPlus, IconSearch, IconX } from '@tabler/icons-react';
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
  const {
    data: aiRules,
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
    // Semantic search
    semanticResults,
    isSemanticMode,
    isSearching,
    isBackfilling,
    handleSemanticSearch,
    handleClearSemanticSearch,
    handleBackfillVectors,
    handleVectorizeAiRule,
  } = useAiRulesDataTable();

  // Local semantic search input state
  const [semanticInput, setSemanticInput] = useState('');

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

  // Handle semantic search submit
  const handleSemanticSearchSubmit = async () => {
    if (!semanticInput.trim()) {
      handleClearSemanticSearch();
      return;
    }
    try {
      await handleSemanticSearch(semanticInput);
    } catch (error) {
      notifications.show({
        title: 'Search Error',
        message: 'Failed to perform semantic search',
        color: 'red',
        icon: <IconX size={16} />,
      });
    }
  };

  // Handle backfill
  const handleBackfill = async () => {
    try {
      const result = await handleBackfillVectors();
      notifications.show({
        title: 'Backfill Complete',
        message: `Processed ${result.data.processed} rules, ${result.data.failed} failed`,
        color: result.data.failed > 0 ? 'yellow' : 'green',
        icon: <IconCheck size={16} />,
      });
    } catch (error) {
      notifications.show({
        title: 'Backfill Error',
        message: 'Failed to backfill vector embeddings',
        color: 'red',
        icon: <IconX size={16} />,
      });
    }
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
        message: 'Failed to vectorize the rule',
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
      render: (rule) => <AiRuleActions rule={rule} onView={handleViewRule} onEdit={handleEditRule} onDelete={handleDeleteRule} onVectorize={handleVectorize} />,
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
          <Group>
            <Button variant="light" leftSection={<IconDatabase size={16} />} onClick={handleBackfill} loading={isBackfilling}>
              Backfill Vectors
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={handleCreateRule} loading={isCreating}>
              Create AI Rule
            </Button>
          </Group>
        </Group>

        {/* Semantic Search Section */}
        <Card withBorder mb="md" p="md">
          <Text fw={500} mb="sm">
            Semantic Search
          </Text>
          <Text size="sm" c="dimmed" mb="md">
            Enter a natural language prompt to retrieve the most semantically related AI rules using vector similarity.
          </Text>
          <Group>
            <TextInput placeholder="e.g., rules about user authentication..." value={semanticInput} onChange={(e) => setSemanticInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSemanticSearchSubmit()} style={{ flex: 1 }} leftSection={<IconSearch size={16} />} />
            <Button onClick={handleSemanticSearchSubmit} loading={isSearching}>
              Search
            </Button>
            {isSemanticMode && (
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  setSemanticInput('');
                  handleClearSemanticSearch();
                }}
              >
                Clear
              </Button>
            )}
          </Group>
        </Card>

        {/* Semantic Search Results */}
        {isSemanticMode && (
          <Card withBorder mb="md" p="md">
            <Text fw={500} mb="sm">
              Search Results ({semanticResults.length} matches)
            </Text>
            {semanticResults.length === 0 ? (
              <Text c="dimmed" size="sm">
                No matching rules found
              </Text>
            ) : (
              <Stack gap="sm">
                {semanticResults.map((result) => (
                  <Card key={result.id} withBorder p="sm">
                    <Group justify="space-between" mb="xs">
                      <Group>
                        <Text fw={500}>{result.name}</Text>
                        <Badge color={result.is_active ? 'green' : 'gray'} size="sm">
                          {result.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </Group>
                      <Badge color="blue" variant="light" size="sm">
                        {(result.similarity_score * 100).toFixed(1)}% match
                      </Badge>
                    </Group>
                    <Progress value={result.similarity_score * 100} size="xs" mb="xs" color="blue" />
                  </Card>
                ))}
              </Stack>
            )}
          </Card>
        )}

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
