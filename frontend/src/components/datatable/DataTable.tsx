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
  striped = true,
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
  minHeight = 200,
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
    if (!onSelectionChange) return;
    onSelectionChange(checked ? data : []);
  };

  const handleSelectRecord = (record: T, checked: boolean) => {
    if (!onSelectionChange) return;
    if (checked) {
      onSelectionChange([...selectedRecords, record]);
      return;
    }
    onSelectionChange(selectedRecords.filter((selected) => selected !== record));
  };

  return (
    <Box className={className} style={style}>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between" spacing={2} mb={2}>
        {searchable ? (
          <TextField
            placeholder={searchPlaceholder}
            value={internalSearchValue}
            onChange={(event) => setInternalSearchValue(event.target.value)}
            sx={{ minWidth: { sm: 280 } }}
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
          <Typography variant="caption" color="text.secondary">
            Sorted by {sortStatus.field} ({sortStatus.direction})
          </Typography>
        ) : null}
      </Stack>

      <TableContainer component={Paper} sx={{ border: withTableBorder ? '1px solid rgba(0,0,0,0.08)' : 0, minHeight }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {withRowSelection ? (
                <TableCell padding="checkbox">
                  <Checkbox checked={allSelected} indeterminate={someSelected} onChange={(event) => handleSelectAll(event.target.checked)} />
                </TableCell>
              ) : null}
              {columns.map((column) => (
                <TableCell key={String(column.accessor)} align={column.textAlign} sx={{ width: column.width, fontWeight: 700, whiteSpace: 'nowrap', cursor: sortable && column.sortable !== false ? 'pointer' : undefined }} onClick={() => handleSort(column)}>
                  <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={column.textAlign === 'right' ? 'flex-end' : column.textAlign === 'center' ? 'center' : 'flex-start'}>
                    <span>{column.title ?? String(column.accessor)}</span>
                    {sortable && column.sortable !== false ? (
                      <Tooltip title="Sort">
                        <SortIcon fontSize="small" color={sortStatus?.field === String(column.accessor) ? 'primary' : 'disabled'} />
                      </Tooltip>
                    ) : null}
                  </Stack>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length + (withRowSelection ? 1 : 0)} align="center" sx={{ py: 6 }}>
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
                <TableCell colSpan={columns.length + (withRowSelection ? 1 : 0)} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {noRecordsText}
                </TableCell>
              </TableRow>
            ) : (
              data.map((record, rowIndex) => (
                <TableRow
                  key={rowIndex}
                  hover={highlightOnHover}
                  selected={selectedSet.has(record)}
                  sx={{
                    bgcolor: striped && rowIndex % 2 === 1 ? 'action.hover' : undefined,
                  }}
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
                        maxWidth: column.width,
                        whiteSpace: (column.accessor === 'prompt' || column.accessor === 'intent' || column.accessor === 'description') ? 'normal' : 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
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
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems="center" justifyContent="space-between" spacing={2} mt={2}>
          <FormControl size="small">
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
          />
        </Stack>
      ) : null}
    </Box>
  );
}
