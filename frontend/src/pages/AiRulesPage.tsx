/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { DataTableColumn } from '@/components/datatable';
import { DataTable } from '@/components/datatable';
import { useAiRulesDataTable, type AiRule, type CreateAiRulePayload, type UpdateAiRulePayload } from '@/hooks/useAiRulesDataTable';

import PageHeader, { HeaderActions } from '@/components/ui/PageHeader';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import SearchIcon from '@mui/icons-material/Search';
import StorageIcon from '@mui/icons-material/Storage';
import UploadIcon from '@mui/icons-material/Upload';
import { Button, Card, Chip, LinearProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { useDisclosure } from '@/components/mui/hooks';
import { modals } from '@/components/mui/modals';
import { notifications } from '@/components/mui/notifications';
import { IconCheck, IconX } from '@/components/mui/icons';

import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AiRuleActions } from '@/components/ai-rules/AiRuleActions';
import { AiRuleDetailModal } from '@/components/ai-rules/AiRuleDetailModal';
import { AiRuleFormModal } from '@/components/ai-rules/AiRuleFormModal';

const getApiErrorMessage = (error: unknown, fallback: string) => {
  const apiError = error as { data?: { message?: string }; message?: string };
  return apiError?.data?.message || apiError?.message || fallback;
};

export default function AiRules() {
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
    handleRecreateVectors,
    handleVectorizeAiRule,
    handleExportAiRules,
    handleImportAiRules,
    isExporting,
    handleBulkDeleteAiRules,
    isBulkDeleting,
    isRecreatingVectors,
  } = useAiRulesDataTable();

  // Local semantic search input state
  const [semanticInput, setSemanticInput] = useState('');

  // Selected rules for export
  const [selectedRules, setSelectedRules] = useState<number[]>([]);

  // Import loading states
  const [isImportingNormal, setIsImportingNormal] = useState(false);
  const [isImportingReplace, setIsImportingReplace] = useState(false);

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
      children: <Typography variant="body2">Are you sure you want to delete the AI rule "{rule.name}"? This action cannot be undone.</Typography>,
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

  const handleRecreate = () => {
    modals.openConfirmModal({
      title: 'Recreate Vectors',
      children: <Typography variant="body2">This will delete all existing vectors and rebuild them from scratch. Continue?</Typography>,
      labels: { confirm: 'Recreate', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          const result = await handleRecreateVectors();
          notifications.show({
            title: 'Recreate Complete',
            message: result.message,
            color: 'green',
            icon: <IconCheck size={16} />,
          });
        } catch (error) {
          notifications.show({
            title: 'Recreate Error',
            message: 'Failed to recreate vectors',
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

  // Handle export
  const handleExport = async (exportAll = false) => {
    try {
      const params = exportAll ? undefined : { ids: selectedRules };
      const result = await handleExportAiRules(params);
      const dataStr = JSON.stringify(result.data, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
      const exportFileDefaultName = `ai-rules-${new Date().toISOString().split('T')[0]}.json`;
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
      notifications.show({
        title: 'Export Complete',
        message: `Exported ${result.data.length} rules`,
        color: 'green',
        icon: <IconCheck size={16} />,
      });
    } catch (error) {
      notifications.show({
        title: 'Export Error',
        message: 'Failed to export rules',
        color: 'red',
        icon: <IconX size={16} />,
      });
    }
  };

  // Handle import
  const handleImport = async (file: File, deleteExisting = false, setLoading: (loading: boolean) => void) => {
    setLoading(true);
    try {
      const text = await file.text();
      const rules = JSON.parse(text);
      if (!Array.isArray(rules)) {
        throw new Error('Invalid file format');
      }
      const result = await handleImportAiRules({ rules: rules as any, deleteExisting });
      notifications.show({
        title: 'Import Complete',
        message: result.message,
        color: result.data.failed > 0 ? 'yellow' : 'green',
        icon: <IconCheck size={16} />,
      });
    } catch (error) {
      notifications.show({
        title: 'Import Error',
        message: 'Failed to import rules',
        color: 'red',
        icon: <IconX size={16} />,
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle bulk delete
  const handleBulkDelete = async () => {
    if (selectedRules.length === 0) return;
    modals.openConfirmModal({
      title: 'Delete Selected AI Rules',
      children: <Typography variant="body2">Are you sure you want to delete {selectedRules.length} selected AI rule(s)? This action cannot be undone.</Typography>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await handleBulkDeleteAiRules(selectedRules);
          setSelectedRules([]);
          notifications.show({
            title: 'Success',
            message: `Deleted ${selectedRules.length} AI rules successfully`,
            color: 'green',
            icon: <IconCheck size={16} />,
          });
        } catch (error) {
          notifications.show({
            title: 'Error',
            message: 'Failed to delete selected AI rules',
            color: 'red',
            icon: <IconX size={16} />,
          });
        }
      },
    });
  };

  // Handle file input for import
  const handleFileImport = (deleteExisting = false) => {
    const setLoading = deleteExisting ? setIsImportingReplace : setIsImportingNormal;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        handleImport(file, deleteExisting, setLoading);
      }
    };
    input.click();
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
        <Typography variant="body2" title={rule.intent} sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {rule.intent}
        </Typography>
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
      accessor: 'scope',
      title: 'Scope',
      render: (rule) => <Chip label={rule.user_id ? 'User' : 'Global'} size="small" color={rule.user_id ? 'primary' : 'success'} variant="outlined" />,
      width: 100,
    },
    {
      accessor: 'vector_exist',
      title: 'Vectorized',
      render: (rule) => <Chip label={rule.vector_exist ? 'Yes' : 'No'} size="small" color={rule.vector_exist ? 'success' : 'error'} variant="outlined" />,
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

      <PageHeader
        title="AI Rules"
        subtitle="Manage global AI rules, vector status, and semantic retrieval."
        action={
          <HeaderActions>
            <Button variant="outlined" startIcon={<StorageIcon />} onClick={handleBackfill} disabled={isBackfilling}>
              Backfill Vectors
            </Button>
            <Button variant="outlined" color="error" startIcon={<StorageIcon />} onClick={handleRecreate} disabled={isRecreatingVectors}>
              Recreate Vectors
            </Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => handleExport(false)} disabled={isExporting || selectedRules.length === 0}>
              Export Selected ({selectedRules.length})
            </Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => handleExport(true)} disabled={isExporting}>
              Export All
            </Button>
            <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={handleBulkDelete} disabled={isBulkDeleting || selectedRules.length === 0}>
              Delete Selected ({selectedRules.length})
            </Button>
            <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => handleFileImport(false)} disabled={isImportingNormal}>
              Import
            </Button>
            <Button variant="outlined" color="error" startIcon={<UploadIcon />} onClick={() => handleFileImport(true)} disabled={isImportingReplace}>
              Import (Replace All)
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateRule} disabled={isCreating}>
              Create AI Rule
            </Button>
          </HeaderActions>
        }
      />

      <Stack spacing={2.5}>
        <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
            Semantic Search
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter a natural language prompt to retrieve the most semantically related AI rules using vector similarity.
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
            <TextField
              placeholder="e.g., rules about user authentication..."
              value={semanticInput}
              onChange={(event) => setSemanticInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleSemanticSearchSubmit()}
              fullWidth
              InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
            />
            <Button variant="contained" onClick={handleSemanticSearchSubmit} disabled={isSearching}>
              Search
            </Button>
            {isSemanticMode && (
              <Button
                variant="outlined"
                color="inherit"
                onClick={() => {
                  setSemanticInput('');
                  handleClearSemanticSearch();
                }}
              >
                Clear
              </Button>
            )}
          </Stack>
        </Paper>

        {isSemanticMode && (
          <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5 }}>
              Search Results ({semanticResults.length} matches)
            </Typography>
            {semanticResults.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No matching rules found
              </Typography>
            ) : (
              <Stack spacing={1}>
                {semanticResults.map((result) => (
                  <Card key={result.id} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>{result.name}</Typography>
                        <Chip label={result.is_active ? 'Active' : 'Inactive'} color={result.is_active ? 'success' : 'default'} size="small" variant="outlined" />
                      </Stack>
                      <Chip color="primary" variant="outlined" size="small" label={`${(result.similarity_score * 100).toFixed(1)}% match`} />
                    </Stack>
                    <LinearProgress variant="determinate" value={result.similarity_score * 100} sx={{ height: 6, borderRadius: 99 }} />
                  </Card>
                ))}
              </Stack>
            )}
          </Paper>
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
          withRowSelection
          selectedRecords={aiRules.filter((rule) => selectedRules.includes(rule.id))}
          onSelectionChange={(selected) => setSelectedRules(selected.map((r) => r.id))}
        />
      </Stack>

      {/* Modals */}
      <AiRuleFormModal opened={formModalOpened} onClose={handleCloseFormModal} onSubmit={handleFormSubmit} rule={editingRule} loading={isCreating || isUpdating} />

      <AiRuleDetailModal opened={detailModalOpened} onClose={handleCloseDetailModal} rule={viewingRule} />
    </>
  );
}
