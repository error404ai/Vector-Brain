import type { DataTableColumn } from '@/components/datatable';
import { DataTable } from '@/components/datatable';
import { useUsersDataTable, type CreateUserPayload, type UpdateUserPayload, type User } from '@/hooks/useUsersDataTable';

import PageHeader, { HeaderActions } from '@/components/ui/PageHeader';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { Button, Chip, Typography } from '@mui/material';
import { useDisclosure } from '@/components/mui/hooks';
import { modals } from '@/components/mui/modals';
import { notifications } from '@/components/mui/notifications';
import { IconCheck, IconX } from '@/components/mui/icons';

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
      render: (user) => <Typography variant="body2">{user.phone || '-'}</Typography>,
    },
    {
      accessor: 'role',
      title: 'Role',
      sortable: true,
      render: (user) => <Chip label={user.role.charAt(0).toUpperCase() + user.role.slice(1)} size="small" color={user.role === 'admin' ? 'error' : user.role === 'user' ? 'primary' : 'default'} variant="outlined" />,
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
      render: (user) => <Typography variant="body2">{new Date(user.createdAt).toLocaleDateString()}</Typography>,
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
      <PageHeader
        title="Users Management"
        subtitle="Manage user accounts and permissions."
        action={
          <HeaderActions>
            {selectedUsers.length > 0 && (
              <Button variant="outlined" color="error" onClick={handleBulkDelete} disabled={isDeleting} startIcon={<DeleteIcon />}>
                Delete Selected ({selectedUsers.length})
              </Button>
            )}
            <Button variant="contained" startIcon={<PersonAddIcon />} onClick={openCreateModal}>
              Add New User
            </Button>
          </HeaderActions>
        }
      />

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

      <UserFormModal opened={createModalOpened} onClose={closeCreateModal} onSubmit={handleCreateSubmit} isLoading={isCreating} title="Create New User" />

      <UserFormModal user={editingUser} opened={editModalOpened} onClose={handleCloseEditModal} onSubmit={handleUpdateSubmit} isLoading={isUpdating} title="Edit User" />
    </>
  );
}
