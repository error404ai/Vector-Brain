import type { SortParams } from '@/components/datatable';
import { useCreateAgentTaskMutation, useDeleteAgentTaskMutation, useGetAgentTasksQuery, type AgentTask, type CreateAgentTaskPayload, type GetAgentTasksParams } from '@/RTKService/agentTaskService/agentTaskService';
import { useCallback, useState } from 'react';

export function useAgentTasksDataTable() {
  // Pagination state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // Search state
  const [search, setSearch] = useState('');

  // Sort state
  const [sort, setSort] = useState<SortParams | undefined>(undefined);

  // Build query params
  const queryParams: GetAgentTasksParams = {
    page,
    limit,
    ...(search && { search }),
    ...(sort && {
      sortField: sort.field,
      sortDirection: sort.direction,
    }),
  };

  // Fetch agent tasks with pagination
  const { data: response, isLoading, isFetching, refetch } = useGetAgentTasksQuery(queryParams);

  // CRUD mutations
  const [createAgentTask, { isLoading: isCreating }] = useCreateAgentTaskMutation();
  const [deleteAgentTask, { isLoading: isDeleting }] = useDeleteAgentTaskMutation();

  // Handlers
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const handleLimitChange = useCallback((newLimit: number) => {
    setLimit(newLimit);
    setPage(1); // Reset to first page when changing limit
  }, []);

  const handleSearchChange = useCallback((newSearch: string) => {
    setSearch(newSearch);
    setPage(1); // Reset to first page when searching
  }, []);

  const handleSortChange = useCallback((newSort: SortParams) => {
    setSort(newSort);
    setPage(1); // Reset to first page when sorting
  }, []);

  const handleCreateAgentTask = useCallback(
    async (data: CreateAgentTaskPayload) => {
      const result = await createAgentTask(data).unwrap();
      return result;
    },
    [createAgentTask]
  );

  const handleDeleteAgentTask = useCallback(
    async (id: number) => {
      const result = await deleteAgentTask(id).unwrap();
      return result;
    },
    [deleteAgentTask]
  );

  return {
    // Data
    data: response?.data ?? [],
    pagination: response?.pagination,

    // Loading states
    isLoading,
    isFetching,
    isCreating,
    isDeleting,

    // Current state
    page,
    limit,
    search,
    sort,

    // State setters
    setPage: handlePageChange,
    setLimit: handleLimitChange,
    setSearch: handleSearchChange,
    setSort: handleSortChange,

    // Handlers
    handleSortChange,
    handleCreateAgentTask,
    handleDeleteAgentTask,
    refetch,
  };
}

export type { AgentTask, CreateAgentTaskPayload };
