import { ColorSchemeScript, MantineProvider, createTheme } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';

// Import Mantine styles
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/notifications/styles.css';
import 'mantine-datatable/styles.layer.css';

interface MantineAppProviderProps {
  children: React.ReactNode;
}

// Create custom theme matching Vector AI Agent's color scheme (light mode)
const theme = createTheme({
  /** Custom theme matching Vector AI Agent's blue color scheme */
  primaryColor: 'vector',
  colors: {
    // Vector AI Agent blue shades
    vector: [
      '#E6F0FA', // lightest
      '#C2DBF2',
      '#9DC6EA',
      '#79B1E2',
      '#549CDA',
      '#0B69C6', // primary (main Vector color)
      '#0A5CAF',
      '#094E98',
      '#074181',
      '#06346A', // darkest
    ],
    // Light mode background colors
    dark: [
      '#1e293b', // text color
      '#334155',
      '#475569',
      '#64748b',
      '#94a3b8',
      '#cbd5e1',
      '#e2e8f0', // light borders
      '#f1f5f9', // sidebar/card backgrounds
      '#f8fafc', // main background
      '#ffffff', // white
    ],
  },
  fontFamily: 'Inter, system-ui, sans-serif',
  headings: {
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  defaultRadius: 'sm',
  other: {
    // Custom gradient colors matching Vector AI Agent
    gradientFrom: '#0B69C6',
    gradientVia: '#e0f2fe',
    gradientTo: '#f8fafc',
    // Accent colors
    accentBlue: '#0B69C6',
    accentCyan: '#22D3EE',
    bgPrimary: '#f8fafc',
    bgSecondary: '#f1f5f9',
    bgCard: '#ffffff',
  },
});

export function MantineAppProvider({ children }: MantineAppProviderProps) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <ModalsProvider>
        <Notifications />
        {children}
      </ModalsProvider>
    </MantineProvider>
  );
}

// Export ColorSchemeScript for head injection
export { ColorSchemeScript };
