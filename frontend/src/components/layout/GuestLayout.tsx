import Logo from '@/components/ui/Logo';
import { Box, Center, Paper, Stack } from '@mantine/core';
import type { ReactNode } from 'react';

interface GuestLayoutProps {
  children: ReactNode;
}

export function GuestLayout({ children }: GuestLayoutProps) {
  return (
    <Box
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #091E38 0%, #0A2E55 50%, #091E38 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <Stack align="center" gap="xl" w="100%" maw={400}>
        <Logo size={48} showText={true} />
        <Paper
          shadow="xl"
          p="xl"
          radius="md"
          w="100%"
          style={{
            backgroundColor: 'rgba(26, 58, 92, 0.8)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {children}
        </Paper>
        <Center>
          <Box
            component="a"
            href="#"
            c="dimmed"
            style={{
              fontSize: '0.75rem',
              textDecoration: 'none',
            }}
          >
            © 2024 Vector Brain. All rights reserved.
          </Box>
        </Center>
      </Stack>
    </Box>
  );
}

export default GuestLayout;
