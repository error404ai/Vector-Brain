import React from 'react';

/**
 * Column definition for DataTable component
 */
export interface DataTableColumn<T = object> {
  accessor: keyof T | string;
  title?: string | React.ReactNode;
  sortable?: boolean;
  searchable?: boolean;
  width?: number | string;
  textAlign?: 'left' | 'center' | 'right';
  render?: (record: T, index: number) => React.ReactNode;
  resizable?: boolean;
}

/**
 * Pagination parameters for API requests
 */
export interface PaginationParams {
  page: number;
  limit: number;
}

/**
 * Sort parameters for API requests
 */
export interface SortParams {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * Filter parameters for API requests
 */
export interface FilterParams {
  search?: string;
  filters?: Record<string, unknown>;
}

/**
 * Combined query parameters for DataTable API requests
 */
export interface DataTableQuery extends PaginationParams, FilterParams {
  sort?: SortParams;
}

/**
 * Response structure from Vector-Brain pagination helper
 * This matches the backend paginationHelper.ts response format
 */
export interface PaginatedResponse<T> {
  message: string;
  data: T[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    pageSize: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
}

/**
 * Props for the DataTable component
 * Adapted to work with Vector-Brain's pagination response structure
 */
export interface DataTableProps<T = object> {
  // Core data props
  columns: DataTableColumn<T>[];
  data?: T[];
  loading?: boolean;

  // Table styling
  withTableBorder?: boolean;
  withColumnBorders?: boolean;
  striped?: boolean;
  highlightOnHover?: boolean;

  // Row selection
  withRowSelection?: boolean;
  selectedRecords?: T[];
  onSelectionChange?: (records: T[]) => void;

  // Sorting
  sortable?: boolean;
  defaultSortStatus?: SortParams;
  onSortStatusChange?: (sort: SortParams) => void;

  // Searching
  searchable?: boolean;
  searchValue?: string;
  onSearchChange?: (search: string) => void;
  searchPlaceholder?: string;

  // Pagination - adapted for Vector-Brain pagination helper
  pagination?: boolean;
  page?: number;
  recordsPerPage?: number;
  totalRecords?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
  onPageChange?: (page: number) => void;
  onRecordsPerPageChange?: (recordsPerPage: number) => void;
  recordsPerPageOptions?: number[];

  // Empty/loading states
  noRecordsText?: string;
  loadingText?: string;

  // Layout
  minHeight?: number;
  verticalSpacing?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  style?: React.CSSProperties;
}
