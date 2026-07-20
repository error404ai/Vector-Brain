import type { DataTableColumn, SortParams } from '@/components/datatable';
import { DataTable } from '@/components/datatable';
import PageHeader from '@/components/ui/PageHeader';
import { useDeleteBrowserWorkerErrorMutation, useGetBrowserWorkerErrorsQuery, useGetBrowserWorkerErrorSummaryQuery, type BrowserWorkerError, type BrowserWorkerErrorListParams } from '@/RTKService/browserWorkerErrorService/browserWorkerErrorService';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.5, minWidth: 180, flex: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ mt: 0.25, fontWeight: 900 }}>
        {value.toLocaleString()}
      </Typography>
    </Paper>
  );
}

function DetailField({ label, value, code = false }: { label: string; value: React.ReactNode; code?: boolean }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 800 }}>
        {label}
      </Typography>
      <Box component={code ? 'pre' : 'div'} sx={{ m: 0, p: code ? 1.5 : 0, bgcolor: code ? 'grey.100' : undefined, borderRadius: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>
        {value}
      </Box>
    </Box>
  );
}

export default function BrowserWorkerErrorsPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortParams>({ field: 'last_seen_at', direction: 'desc' });
  const [selected, setSelected] = useState<BrowserWorkerError>();

  const allowedSortFields = new Set(['last_seen_at', 'first_seen_at', 'occurrence_count', 'error_code', 'extension_version']);
  const params: BrowserWorkerErrorListParams = {
    page,
    limit,
    ...(search ? { search } : {}),
    ...(allowedSortFields.has(sort.field) ? { sortField: sort.field as BrowserWorkerErrorListParams['sortField'], sortDirection: sort.direction } : {}),
  };
  const { data, isLoading } = useGetBrowserWorkerErrorsQuery(params);
  const { data: summary } = useGetBrowserWorkerErrorSummaryQuery();
  const [deleteError, { isLoading: isDeleting }] = useDeleteBrowserWorkerErrorMutation();

  async function removeSelected() {
    if (!selected || !window.confirm('Delete this BrowserWorker error group?')) return;
    await deleteError(selected.id).unwrap();
    setSelected(undefined);
  }

  const columns: DataTableColumn<BrowserWorkerError>[] = [
    {
      accessor: 'error_code',
      title: 'Error',
      sortable: true,
      render: (error) => <Chip label={error.error_code} size="small" color="error" variant="outlined" />,
    },
    {
      accessor: 'message',
      title: 'Latest sanitized message',
      sortable: false,
      render: (error) => (
        <Typography variant="body2" sx={{ maxWidth: 460, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {error.message}
        </Typography>
      ),
    },
    { accessor: 'phase', title: 'Phase', sortable: false },
    { accessor: 'extension_version', title: 'Version', sortable: true },
    { accessor: 'browser', title: 'Browser', sortable: false },
    {
      accessor: 'occurrence_count',
      title: 'Occurrences',
      sortable: true,
      textAlign: 'right',
      render: (error) => error.occurrence_count.toLocaleString(),
    },
    {
      accessor: 'last_seen_at',
      title: 'Last seen',
      sortable: true,
      render: (error) => new Date(error.last_seen_at).toLocaleString(),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      sortable: false,
      textAlign: 'center',
      render: (error) => (
        <IconButton aria-label="View error details" size="small" onClick={() => setSelected(error)}>
          <VisibilityIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  return (
    <>
      <Helmet>
        <title>BrowserWorker Errors - Vector Brain</title>
      </Helmet>
      <PageHeader title="BrowserWorker Errors" subtitle="Aggregated, sanitized failures reported by the browser extension." />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <Stat label="Error groups" value={summary?.data.total_groups ?? 0} />
        <Stat label="Total occurrences" value={summary?.data.total_occurrences ?? 0} />
        <Stat label="Seen in last 24h" value={summary?.data.active_groups_24h ?? 0} />
      </Stack>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        striped
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search error code, message, or tool..."
        defaultSortStatus={sort}
        onSortStatusChange={(value) => {
          setSort(value);
          setPage(1);
        }}
        page={data?.pagination.currentPage ?? page}
        recordsPerPage={data?.pagination.pageSize ?? limit}
        totalRecords={data?.pagination.totalCount ?? 0}
        onPageChange={setPage}
        onRecordsPerPageChange={(value) => {
          setLimit(value);
          setPage(1);
        }}
        recordsPerPageOptions={[10, 20, 50, 100]}
        noRecordsText="No BrowserWorker errors have been reported."
        loadingText="Loading BrowserWorker errors..."
      />

      <Dialog open={Boolean(selected)} onClose={() => setSelected(undefined)} fullWidth maxWidth="md">
        <DialogTitle sx={{ pr: 6 }}>
          BrowserWorker Error Details
          <IconButton onClick={() => setSelected(undefined)} sx={{ position: 'absolute', right: 12, top: 12 }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selected ? (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={selected.error_code} color="error" variant="outlined" />
                <Chip label={`${selected.occurrence_count.toLocaleString()} occurrences`} />
                <Chip label={`v${selected.extension_version}`} />
                <Chip label={selected.browser} />
              </Stack>
              <DetailField label="Message" value={selected.message} code />
              <DetailField label="Stack" value={selected.stack} code />
              <DetailField label="Phase" value={selected.phase} />
              <DetailField label="Provider / model" value={[selected.provider, selected.model].filter(Boolean).join(' / ')} />
              <DetailField label="Tool" value={selected.tool} />
              <DetailField label="Step" value={selected.step} />
              <DetailField label="Task duration" value={selected.task_duration_ms == null ? null : `${(selected.task_duration_ms / 1000).toFixed(1)} seconds`} />
              <DetailField label="First seen" value={new Date(selected.first_seen_at).toLocaleString()} />
              <DetailField label="Last seen" value={new Date(selected.last_seen_at).toLocaleString()} />
              <DetailField label="Fingerprint" value={selected.fingerprint} code />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button color="error" startIcon={<DeleteIcon />} onClick={() => void removeSelected()} disabled={isDeleting}>
            Delete group
          </Button>
          <Button onClick={() => setSelected(undefined)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
