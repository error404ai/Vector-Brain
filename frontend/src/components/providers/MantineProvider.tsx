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

// Create custom theme matching Vector AI Agent's color scheme (dark blue theme)
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
    // Dark blue background colors matching Vector AI Agent
    dark: [
      '#C1C2C5',
      '#A6A7AB',
      '#909296',
      '#5C5F66',
      '#373A40',
      '#2C2E33',
      '#1A3A5C', // sidebar/card backgrounds
      '#0A2E55', // hover states
      '#091E38', // main background (Vector AI Agent)
      '#061525', // darkest
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
    gradientVia: '#0A1E38',
    gradientTo: '#091E38',
    // Accent colors
    accentBlue: '#0B69C6',
    accentCyan: '#22D3EE',
    bgPrimary: '#091E38',
    bgSecondary: '#0A2E55',
    bgCard: '#1A3A5C',
  },
});

export function MantineAppProvider({ children }: MantineAppProviderProps) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <ModalsProvider>
        <Notifications />
        {children}
      </ModalsProvider>
    </MantineProvider>
  );
}

// Export ColorSchemeScript for head injection
export { ColorSchemeScript };
