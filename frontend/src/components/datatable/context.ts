import { createContext, useContext } from 'react';

/**
 * DataTable context type for sharing configuration across components
 */
export interface DataTableContextType {
  theme?: 'light' | 'dark';
}

/**
 * DataTable context instance
 */
export const DataTableContext = createContext<DataTableContextType | undefined>(undefined);

/**
 * Hook to access DataTable context
 * @throws Error if used outside of DataTableProvider
 */
export function useDataTableContext(): DataTableContextType {
  const context = useContext(DataTableContext);
  if (context === undefined) {
    throw new Error('useDataTableContext must be used within a DataTableProvider');
  }
  return context;
}
