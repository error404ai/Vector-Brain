import type { SortParams } from '@/components/datatable';
import { useCreateAiRuleMutation, useDeleteAiRuleMutation, useGetAiRulesQuery, useUpdateAiRuleMutation, type AiRule, type CreateAiRulePayload, type GetAiRulesParams, type UpdateAiRulePayload } from '@/RTKService/aiRuleService/aiRuleService';
import { useCallback, useState } from 'react';

export function useAiRulesDataTable() {
  // Pagination state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // Search state
  const [search, setSearch] = useState('');

  // Sort state
  const [sort, setSort] = useState<SortParams | undefined>(undefined);

  // Build query params
  const queryParams: GetAiRulesParams = {
    page,
    limit,
    ...(search && { search }),
    ...(sort && {
      sortField: sort.field,
      sortDirection: sort.direction,
    }),
  };

  // Fetch AI rules with pagination
  const { data: response, isLoading, isFetching, refetch } = useGetAiRulesQuery(queryParams);

  // CRUD mutations
  const [createAiRule, { isLoading: isCreating }] = useCreateAiRuleMutation();
  const [updateAiRule, { isLoading: isUpdating }] = useUpdateAiRuleMutation();
  const [deleteAiRule, { isLoading: isDeleting }] = useDeleteAiRuleMutation();

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

  const handleCreateAiRule = useCallback(
    async (data: CreateAiRulePayload) => {
      const result = await createAiRule(data).unwrap();
      return result;
    },
    [createAiRule]
  );

  const handleUpdateAiRule = useCallback(
    async (id: number, data: UpdateAiRulePayload) => {
      const result = await updateAiRule({ id, data }).unwrap();
      return result;
    },
    [updateAiRule]
  );

  const handleDeleteAiRule = useCallback(
    async (id: number) => {
      const result = await deleteAiRule(id).unwrap();
      return result;
    },
    [deleteAiRule]
  );

  return {
    // Data
    data: response?.data ?? [],
    pagination: response?.pagination,

    // Loading states
    isLoading,
    isFetching,
    isCreating,
    isUpdating,
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
    handleCreateAiRule,
    handleUpdateAiRule,
    handleDeleteAiRule,
    refetch,
  };
}

export type { AiRule, CreateAiRulePayload, UpdateAiRulePayload };
