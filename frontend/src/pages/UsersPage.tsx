import type { DataTableColumn } from '@/components/datatable';
import { DataTable } from '@/components/datatable';
import { useUsersDataTable, type CreateUserPayload, type UpdateUserPayload, type User } from '@/hooks/useUsersDataTable';

import { Badge, Box, Button, Group, Text, Title } from '@/components/mui/core';
import { useDisclosure } from '@/components/mui/hooks';
import { modals } from '@/components/mui/modals';
import { notifications } from '@/components/mui/notifications';
import { IconCheck, IconUserPlus, IconX } from '@/components/mui/icons';

import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { UserActions } from '@/components/users/UserActions';
import { UserFormModal } from '@/components/users/UserFormModal';
import { UserStatusBadge } from '@/components/users/UserStatusBadge';

export default function Users() {
  // Get users data and handlers from custom hook
  const { data: users, pagination, isLoading, isCreating, isUpdating, isDeleting, page, limit, search, setPage, setLimit, setSearch, handleSortChange, handleCreateUser, handleUpdateUser, handleDeleteUser } = useUsersDataTable();

  // Row selection state
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);

  // Edit user state
  const [editingUser, setEditingUser] = useState<User | undefined>();

  // Modal states
  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure(false);
  const [editModalOpened, { open: openEditModal, close: closeEditModal }] = useDisclosure(false);

  // Handlers
  const handleEditUser = (user: User) => {
    setEditingUser(user);
    openEditModal();
  };

  const handleCloseEditModal = () => {
    setEditingUser(undefined);
    closeEditModal();
  };

  const handleCreateSubmit = async (data: CreateUserPayload | UpdateUserPayload) => {
    await handleCreateUser(data as CreateUserPayload);
    closeCreateModal();
  };

  const handleUpdateSubmit = async (data: CreateUserPayload | UpdateUserPayload) => {
    if (editingUser) {
      await handleUpdateUser(editingUser.id, data as UpdateUserPayload);
      handleCloseEditModal();
    }
  };

  const handleBulkDelete = () => {
    if (selectedUsers.length === 0) return;

    modals.openConfirmModal({
      title: 'Delete Users',
      children: `Are you sure you want to delete ${selectedUsers.length} user(s)? This action cannot be undone.`,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          // Delete users one by one
          await Promise.all(selectedUsers.map((user) => handleDeleteUser(user.id)));
          setSelectedUsers([]);
          notifications.show({
            title: 'Success',
            message: `${selectedUsers.length} user(s) deleted successfully`,
            color: 'green',
            icon: <IconCheck size="1rem" />,
          });
        } catch (error) {
          notifications.show({
            title: 'Error',
            message: error instanceof Error ? error.message : 'Failed to delete users',
            color: 'red',
            icon: <IconX size="1rem" />,
          });
        }
      },
    });
  };

  // Column definitions
  const columns: DataTableColumn<User>[] = [
    {
      accessor: 'id',
      title: 'ID',
      width: 80,
      sortable: true,
    },
    {
      accessor: 'name',
      title: 'Name',
      sortable: true,
      searchable: true,
    },
    {
      accessor: 'email',
      title: 'Email',
      sortable: true,
      searchable: true,
    },
    {
      accessor: 'phone',
      title: 'Phone',
      sortable: false,
      render: (user) => <Text size="sm">{user.phone || '-'}</Text>,
    },
    {
      accessor: 'role',
      title: 'Role',
      sortable: true,
      render: (user) => (
        <Badge color={user.role === 'admin' ? 'red' : user.role === 'user' ? 'blue' : 'gray'} variant="light" size="sm">
          {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
        </Badge>
      ),
    },
    {
      accessor: 'isActive',
      title: 'Status',
      sortable: true,
      render: (user) => <UserStatusBadge isActive={user.isActive} />,
    },
    {
      accessor: 'createdAt',
      title: 'Created',
      sortable: true,
      render: (user) => <Text size="sm">{new Date(user.createdAt).toLocaleDateString()}</Text>,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      textAlign: 'center',
      sortable: false,
      render: (user) => <UserActions user={user} onEdit={handleEditUser} onDelete={handleDeleteUser} isDeleting={isDeleting} />,
    },
  ];

  return (
    <>
      <Helmet>
        <title>Users - Vector Brain</title>
      </Helmet>
      <Box>
        {/* Page Header */}
        <Group justify="space-between" mb="xl">
          <div>
            <Title order={2}>Users Management</Title>
            <Text c="dimmed" size="sm">
              Manage user accounts and permissions
            </Text>
          </div>
          <Group>
            {selectedUsers.length > 0 && (
              <Button variant="light" color="red" onClick={handleBulkDelete} loading={isDeleting}>
                Delete Selected ({selectedUsers.length})
              </Button>
            )}
            <Button leftSection={<IconUserPlus size="1rem" />} onClick={openCreateModal}>
              Add New User
            </Button>
          </Group>
        </Group>

        {/* DataTable */}
        <DataTable<User>
          columns={columns}
          data={users}
          loading={isLoading}
          withTableBorder
          striped
          highlightOnHover
          withRowSelection
          selectedRecords={selectedUsers}
          onSelectionChange={setSelectedUsers}
          sortable
          onSortStatusChange={handleSortChange}
          searchable
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search users by name or email..."
          pagination
          page={pagination?.currentPage ?? page}
          recordsPerPage={pagination?.pageSize ?? limit}
          totalRecords={pagination?.totalCount ?? 0}
          totalPages={pagination?.totalPages}
          hasPreviousPage={pagination?.hasPreviousPage}
          hasNextPage={pagination?.hasNextPage}
          onPageChange={setPage}
          onRecordsPerPageChange={setLimit}
          recordsPerPageOptions={[5, 10, 20, 50]}
          noRecordsText="No users found"
          loadingText="Loading users..."
          minHeight={300}
          verticalSpacing="sm"
        />

        {/* Create User Modal */}
        <UserFormModal opened={createModalOpened} onClose={closeCreateModal} onSubmit={handleCreateSubmit} isLoading={isCreating} title="Create New User" />

        {/* Edit User Modal */}
        <UserFormModal user={editingUser} opened={editModalOpened} onClose={handleCloseEditModal} onSubmit={handleUpdateSubmit} isLoading={isUpdating} title="Edit User" />
      </Box>
    </>
  );
}
