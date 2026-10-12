import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Box, Button, IconButton, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  backPath?: string;
}

export default function PageHeader({ title, subtitle, action, backPath }: PageHeaderProps) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        flexWrap: 'wrap',
        alignItems: { xs: 'stretch', sm: 'flex-end' },
        justifyContent: 'space-between',
        gap: 2,
        mb: { xs: 2, md: 3 },
      }}
    >
      {/* The title keeps at least 280px; a wide row of actions wraps under it instead of squeezing it. */}
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0, flex: '1 1 280px' }}>
        {backPath ? (
          <IconButton onClick={() => (backPath === '-1' ? navigate(-1) : navigate(backPath))} size="small">
            <ArrowBackIcon />
          </IconButton>
        ) : null}
        <Box sx={{ minWidth: 0 }}>
          {/* Prism heading, as on Mission Control and Settings: big, tight, ink on the prism. */}
          <Typography
            component="h1"
            sx={{ m: 0, fontSize: compact ? 30 : 42, lineHeight: 1.05, fontWeight: 800, letterSpacing: '-0.045em', color: '#141a2e', wordBreak: 'break-word' }}
          >
            {title}
          </Typography>
          {subtitle ? (
            <Typography sx={{ mt: 1, fontSize: 15, lineHeight: 1.55, color: '#3c435e', maxWidth: 640, wordBreak: 'break-word' }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
      </Stack>
      {action ? (
        <Box sx={{ minWidth: 0, maxWidth: '100%', alignSelf: { xs: 'stretch', sm: 'center' }, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' } } }}>
          {action}
        </Box>
      ) : null}
    </Box>
  );
}

export function HeaderActions({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} flexWrap="wrap" useFlexGap gap={1} sx={{ width: { xs: '100%', sm: 'auto' }, justifyContent: { sm: 'flex-end' } }}>
      {children}
    </Stack>
  );
}

export function HeaderButton(props: React.ComponentProps<typeof Button>) {
  return <Button variant="contained" {...props} />;
}
