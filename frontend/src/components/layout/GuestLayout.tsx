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
        background: 'linear-gradient(135deg, #f8fafc 0%, #e0f2fe 50%, #f8fafc 100%)',
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
            backgroundColor: '#ffffff',
            border: '1px solid rgba(0,0,0,0.1)',
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
