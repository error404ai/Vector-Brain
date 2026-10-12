import Logo from '@/components/ui/Logo';
import PrismBackground from '@/components/ui/PrismBackground';
import { Box, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface GuestLayoutProps {
  children: ReactNode;
}

/** Sign-in and sign-up: one glass card on the app's prism. */
export function GuestLayout({ children }: GuestLayoutProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 4,
      }}
    >
      <PrismBackground />
      <Stack alignItems="center" spacing={3} sx={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        <Logo size={42} showText={true} />
        <Paper
          elevation={0}
          sx={{
            width: '100%',
            backgroundColor: 'rgba(255,255,255,.82)',
            backdropFilter: 'blur(22px)',
            WebkitBackdropFilter: 'blur(22px)',
            border: '1px solid rgba(255,255,255,.95)',
            borderRadius: '26px',
            boxShadow: '0 30px 70px rgba(30, 40, 90, 0.14)',
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
