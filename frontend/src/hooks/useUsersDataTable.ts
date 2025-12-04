import type { SortParams } from '@/components/datatable';
import { useCreateUserMutation, useDeleteUserMutation, useGetUsersQuery, useUpdateUserMutation, type CreateUserPayload, type GetUsersParams, type UpdateUserPayload, type User } from '@/RTKService/userService/userService';
import { useCallback, useState } from 'react';

/**
 * Hook for managing users DataTable state and server communication
 *
 * Provides all necessary state and handlers for server-side pagination,
 * sorting, searching, and CRUD operations.
 *
 * @example
 * const {
 *   data,
 *   pagination,
 *   isLoading,
 *   page,
 *   limit,
 *   search,
 *   setPage,
 *   setLimit,
 *   setSearch,
 *   handleSortChange,
 *   handleCreateUser,
 *   handleUpdateUser,
 *   handleDeleteUser,
 * } = useUsersDataTable();
 */
export function useUsersDataTable() {
  // Pagination state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // Search state
  const [search, setSearch] = useState('');

  // Sort state
  const [sort, setSort] = useState<SortParams | undefined>(undefined);

  // Build query params
  const queryParams: GetUsersParams = {
    page,
    limit,
    ...(search && { search }),
    ...(sort && {
      sortField: sort.field,
      sortDirection: sort.direction,
    }),
  };

  // Fetch users with pagination
  const { data: response, isLoading, isFetching, refetch } = useGetUsersQuery(queryParams);

  // CRUD mutations
  const [createUser, { isLoading: isCreating }] = useCreateUserMutation();
  const [updateUser, { isLoading: isUpdating }] = useUpdateUserMutation();
  const [deleteUser, { isLoading: isDeleting }] = useDeleteUserMutation();

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

  const handleCreateUser = useCallback(
    async (data: CreateUserPayload) => {
      const result = await createUser(data).unwrap();
      return result;
    },
    [createUser]
  );

  const handleUpdateUser = useCallback(
    async (id: number, data: UpdateUserPayload) => {
      const result = await updateUser({ id, data }).unwrap();
      return result;
    },
    [updateUser]
  );

  const handleDeleteUser = useCallback(
    async (id: number) => {
      const result = await deleteUser(id).unwrap();
      return result;
    },
    [deleteUser]
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
    handleCreateUser,
    handleUpdateUser,
    handleDeleteUser,
    refetch,
  };
}

export type { CreateUserPayload, UpdateUserPayload, User };
