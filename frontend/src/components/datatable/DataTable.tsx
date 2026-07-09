import SearchIcon from '@mui/icons-material/Search';
import SortIcon from '@mui/icons-material/SwapVert';
import {
  Box,
  Checkbox,
  CircularProgress,
  FormControl,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useEffect, useMemo, useState } from 'react';
import type { DataTableColumn, DataTableProps, SortParams } from './types';

function getRecordValue<T extends object>(record: T, accessor: keyof T | string) {
  return record[accessor as keyof T] as React.ReactNode;
}

export function DataTable<T extends object>({
  columns,
  data = [],
  loading = false,
  withTableBorder = true,
  striped = false,
  highlightOnHover = true,
  withRowSelection = false,
  selectedRecords = [],
  onSelectionChange,
  sortable = true,
  defaultSortStatus,
  onSortStatusChange,
  searchable = true,
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Search...',
  pagination = true,
  page = 1,
  recordsPerPage = 10,
  totalRecords = data.length,
  onPageChange,
  onRecordsPerPageChange,
  recordsPerPageOptions = [5, 10, 20, 50],
  noRecordsText = 'No records found',
  loadingText = 'Loading...',
  minHeight = 240,
  className,
  style,
}: DataTableProps<T>) {
  const [internalSearchValue, setInternalSearchValue] = useState(searchValue);
  const [sortStatus, setSortStatus] = useState<SortParams | undefined>(defaultSortStatus);

  useEffect(() => {
    setInternalSearchValue(searchValue);
  }, [searchValue]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (internalSearchValue !== searchValue) {
        onSearchChange?.(internalSearchValue);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [internalSearchValue, onSearchChange, searchValue]);

  const selectedSet = useMemo(() => new Set(selectedRecords), [selectedRecords]);
  const allSelected = data.length > 0 && data.every((record) => selectedSet.has(record));
  const someSelected = data.some((record) => selectedSet.has(record)) && !allSelected;

  const handleSort = (column: DataTableColumn<T>) => {
    if (!sortable || column.sortable === false) return;
    const field = String(column.accessor);
    const direction = sortStatus?.field === field && sortStatus.direction === 'asc' ? 'desc' : 'asc';
    const nextSort = { field, direction } as SortParams;
    setSortStatus(nextSort);
    onSortStatusChange?.(nextSort);
  };

  const handleSelectAll = (checked: boolean) => {
    onSelectionChange?.(checked ? data : []);
  };

  const handleSelectRecord = (record: T, checked: boolean) => {
    if (!onSelectionChange) return;
    onSelectionChange(checked ? [...selectedRecords, record] : selectedRecords.filter((selected) => selected !== record));
  };

  return (
    <Paper className={className} style={style} sx={{ overflow: 'hidden', border: withTableBorder ? undefined : 0 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {searchable ? (
          <TextField
            placeholder={searchPlaceholder}
            value={internalSearchValue}
            onChange={(event) => setInternalSearchValue(event.target.value)}
            sx={{ maxWidth: { md: 360 }, width: '100%' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
        ) : (
          <Box />
        )}
        {sortStatus ? (
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            Sorted by {sortStatus.field} ({sortStatus.direction})
          </Typography>
        ) : null}
      </Stack>

      <TableContainer sx={{ minHeight, maxWidth: '100%' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {withRowSelection ? (
                <TableCell padding="checkbox">
                  <Checkbox checked={allSelected} indeterminate={someSelected} onChange={(event) => handleSelectAll(event.target.checked)} />
                </TableCell>
              ) : null}
              {columns.map((column) => {
                const isSortable = sortable && column.sortable !== false;
                return (
                  <TableCell
                    key={String(column.accessor)}
                    align={column.textAlign}
                    sx={{ width: column.width, whiteSpace: 'nowrap', cursor: isSortable ? 'pointer' : undefined }}
                    onClick={() => handleSort(column)}
                  >
                    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={column.textAlign === 'right' ? 'flex-end' : column.textAlign === 'center' ? 'center' : 'flex-start'}>
                      <Box component="span">{column.title ?? String(column.accessor)}</Box>
                      {isSortable ? (
                        <Tooltip title="Sort">
                          <SortIcon fontSize="small" color={sortStatus?.field === String(column.accessor) ? 'primary' : 'disabled'} />
                        </Tooltip>
                      ) : null}
                    </Stack>
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length + (withRowSelection ? 1 : 0)} align="center" sx={{ py: 8 }}>
                  <Stack alignItems="center" spacing={1}>
                    <CircularProgress size={24} />
                    <Typography variant="body2" color="text.secondary">
                      {loadingText}
                    </Typography>
                  </Stack>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (withRowSelection ? 1 : 0)} align="center" sx={{ py: 8 }}>
                  <Typography variant="body2" color="text.secondary">
                    {noRecordsText}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              data.map((record, rowIndex) => (
                <TableRow
                  key={rowIndex}
                  hover={highlightOnHover}
                  selected={selectedSet.has(record)}
                  sx={(theme) => ({
                    bgcolor: striped && rowIndex % 2 === 1 ? alpha(theme.palette.primary.main, 0.018) : undefined,
                    '&.Mui-selected': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
                    '& td': { borderBottomColor: 'divider' },
                  })}
                >
                  {withRowSelection ? (
                    <TableCell padding="checkbox">
                      <Checkbox checked={selectedSet.has(record)} onChange={(event) => handleSelectRecord(record, event.target.checked)} />
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell
                      key={String(column.accessor)}
                      align={column.textAlign}
                      sx={{
                        width: column.width,
                        maxWidth: column.width ?? 360,
                        whiteSpace: column.accessor === 'prompt' || column.accessor === 'intent' || column.accessor === 'description' ? 'normal' : 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        py: 1.1,
                      }}
                    >
                      {column.render ? column.render(record, rowIndex) : getRecordValue(record, column.accessor)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {pagination ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems="center" justifyContent="space-between" spacing={1.5} sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select value={recordsPerPage} onChange={(event) => onRecordsPerPageChange?.(Number(event.target.value))}>
              {recordsPerPageOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option} / page
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TablePagination
            component="div"
            count={totalRecords}
            page={Math.max(page - 1, 0)}
            rowsPerPage={recordsPerPage}
            rowsPerPageOptions={[]}
            onPageChange={(_event, nextPage) => onPageChange?.(nextPage + 1)}
            onRowsPerPageChange={(event) => onRecordsPerPageChange?.(Number(event.target.value))}
            sx={{ border: 0 }}
          />
        </Stack>
      ) : null}
    </Paper>
  );
}
