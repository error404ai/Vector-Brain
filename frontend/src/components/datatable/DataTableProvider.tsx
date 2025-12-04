import type { ReactNode } from 'react';
import type { DataTableContextType } from './context';
import { DataTableContext } from './context';

export interface DataTableProviderProps {
  children: ReactNode;
  theme?: 'light' | 'dark';
}

/**
 * DataTable context provider
 * Wraps children with DataTable context for shared configuration
 */
export function DataTableProvider({ children, theme = 'light' }: DataTableProviderProps) {
  const value: DataTableContextType = {
    theme,
  };

  return <DataTableContext.Provider value={value}>{children}</DataTableContext.Provider>;
}
