import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import type { ReactNode } from 'react';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0B69C6', light: '#549CDA', dark: '#074181' },
    secondary: { main: '#22D3EE', light: '#67E8F9', dark: '#0891B2' },
    background: { default: '#f8fafc', paper: '#ffffff' },
    success: { main: '#2E7D32' },
    error: { main: '#D32F2F' },
    warning: { main: '#ED6C02' },
    info: { main: '#0288D1' },
  },
  typography: {
    fontFamily: 'Inter, system-ui, sans-serif',
    h4: { fontWeight: 800 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 6 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 6 },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { border: '1px solid rgba(0,0,0,0.08)' },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { border: '1px solid rgba(0,0,0,0.08)' },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
  },
});

interface MUIProviderProps {
  children: ReactNode;
}

export function MUIProvider({ children }: MUIProviderProps) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
