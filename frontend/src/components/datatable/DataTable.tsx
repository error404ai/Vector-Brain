import { ActionIcon, Box, Group, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconColumns, IconSearch, IconSortAscending, IconSortDescending } from '@tabler/icons-react';
import type { DataTableColumnTextAlign, DataTableSortStatus, DataTableColumn as MantineColumn, DataTableProps as MantineDataTableProps } from 'mantine-datatable';
import { DataTable as MantineDataTable } from 'mantine-datatable';
import { useEffect, useState } from 'react';
import type { DataTableColumn, DataTableProps, SortParams } from './types';

export function DataTable<T extends object>({
  columns,
  data = [],
  loading = false,
  withTableBorder = true,
  withColumnBorders = false,
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
  verticalSpacing = 'sm',
  className,
  style,
}: DataTableProps<T>) {
  const [internalSearchValue, setInternalSearchValue] = useState(searchValue);
  const [sortStatus, setSortStatus] = useState<SortParams | undefined>(defaultSortStatus);
  const [columnOrder] = useState<DataTableColumn<T>[]>(columns);
  const [debouncedSearch] = useDebouncedValue(internalSearchValue, 300);

  // Handle search changes with debounce
  useEffect(() => {
    if (onSearchChange && debouncedSearch !== searchValue) {
      onSearchChange(debouncedSearch);
    }
  }, [debouncedSearch, onSearchChange, searchValue]);

  // Keep internal input in sync when parent controls searchValue
  useEffect(() => {
    if (searchValue !== internalSearchValue) {
      setInternalSearchValue(searchValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  // Handle sort changes
  const handleSortChange: (newSortStatus: DataTableSortStatus<T> | undefined) => void = (newSortStatus) => {
    if (!newSortStatus) return;
    const sort: SortParams = {
      field: String(newSortStatus.columnAccessor),
      direction: newSortStatus.direction,
    };
    setSortStatus(sort);
    if (onSortStatusChange) {
      onSortStatusChange(sort);
    }
  };

  // Convert our column format to mantine-datatable format
  const mantineColumns: MantineColumn<T>[] = columnOrder.map((column) => ({
    accessor: column.accessor as unknown as keyof T | (string & NonNullable<unknown>),
    title: column.title,
    width: column.width,
    textAlign: column.textAlign as DataTableColumnTextAlign | undefined,
    sortable: sortable && column.sortable !== false,
    render: column.render,
    resizable: column.resizable,
  }));

  const handlePageChangeInternal = (p: number) => {
    if (onPageChange) onPageChange(p);
  };

  const handleRecordsPerPageChangeInternal = (r: number) => {
    if (onRecordsPerPageChange) onRecordsPerPageChange(r);
  };

  // Build mantine-datatable props
  const baseProps: Omit<MantineDataTableProps<T>, 'page' | 'onPageChange' | 'totalRecords' | 'recordsPerPage' | 'onRecordsPerPageChange' | 'recordsPerPageOptions'> = {
    withTableBorder,
    withColumnBorders,
    striped,
    highlightOnHover,
    records: data,
    columns: mantineColumns,
    selectedRecords: withRowSelection ? selectedRecords : undefined,
    onSelectedRecordsChange: withRowSelection ? onSelectionChange : undefined,
    sortStatus: sortStatus
      ? ({
          columnAccessor: sortStatus.field as unknown as (string & NonNullable<unknown>) | keyof T,
          direction: sortStatus.direction,
        } as DataTableSortStatus<T>)
      : undefined,
    onSortStatusChange: (sortable ? handleSortChange : undefined) as MantineDataTableProps<T>['onSortStatusChange'],
    fetching: loading,
    loaderType: 'dots',
    loaderBackgroundBlur: 1,
    noRecordsText,
    loadingText,
    minHeight,
    verticalSpacing,
  };

  const renderedProps: MantineDataTableProps<T> = pagination
    ? ({
        ...baseProps,
        page,
        onPageChange: handlePageChangeInternal,
        totalRecords,
        recordsPerPage,
        ...(onRecordsPerPageChange
          ? {
              onRecordsPerPageChange: handleRecordsPerPageChangeInternal,
              recordsPerPageOptions,
            }
          : {}),
      } as MantineDataTableProps<T>)
    : (baseProps as MantineDataTableProps<T>);

  return (
    <Box className={className} style={style}>
      {/* Header with search and controls */}
      <Group justify="space-between" mb="md">
        <Group>{searchable && <TextInput placeholder={searchPlaceholder} leftSection={<IconSearch size="1rem" />} value={internalSearchValue} onChange={(event) => setInternalSearchValue(event.currentTarget.value)} style={{ minWidth: 250 }} />}</Group>
        <Group>
          {sortStatus && (
            <Tooltip label={`Sorted by ${sortStatus.field} (${sortStatus.direction})`}>
              <ActionIcon variant="light" size="sm">
                {sortStatus.direction === 'asc' ? <IconSortAscending size="1rem" /> : <IconSortDescending size="1rem" />}
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label="Column options">
            <ActionIcon variant="light" size="sm">
              <IconColumns size="1rem" />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Main DataTable */}
      <MantineDataTable<T> {...renderedProps} />
    </Box>
  );
}
