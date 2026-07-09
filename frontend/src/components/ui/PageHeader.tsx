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
        alignItems: { xs: 'stretch', sm: 'center' },
        justifyContent: 'space-between',
        gap: 2,
        mb: { xs: 2, md: 3 },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
        {backPath ? (
          <IconButton onClick={() => (backPath === '-1' ? navigate(-1) : navigate(backPath))} size="small">
            <ArrowBackIcon />
          </IconButton>
        ) : null}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant={compact ? 'h6' : 'h4'} sx={{ fontWeight: 900, wordBreak: 'break-word' }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, wordBreak: 'break-word' }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
      </Stack>
      {action ? (
        <Box sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'center' }, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' } } }}>
          {action}
        </Box>
      ) : null}
    </Box>
  );
}

export function HeaderActions({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', sm: 'auto' } }}>
      {children}
    </Stack>
  );
}

export function HeaderButton(props: React.ComponentProps<typeof Button>) {
  return <Button variant="contained" {...props} />;
}
