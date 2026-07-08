import Logo from '@/components/ui/Logo';
import { Box, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface GuestLayoutProps {
  children: ReactNode;
}

export function GuestLayout({ children }: GuestLayoutProps) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f8fbff 0%, #e5f6ff 48%, #f8fbff 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 4,
      }}
    >
      <Stack alignItems="center" spacing={3} sx={{ width: '100%', maxWidth: 420 }}>
        <Logo size={42} showText={true} />
        <Paper
          elevation={0}
          sx={{
            width: '100%',
            backgroundColor: '#ffffff',
            border: '1px solid rgba(15, 23, 42, 0.1)',
            borderRadius: 1,
            boxShadow: '0 16px 40px rgba(15, 23, 42, 0.08)',
            p: { xs: 3, sm: 4 },
          }}
        >
          {children}
        </Paper>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
          © 2025 Vector Brain. All rights reserved.
        </Typography>
      </Stack>
    </Box>
  );
}

export default GuestLayout;
