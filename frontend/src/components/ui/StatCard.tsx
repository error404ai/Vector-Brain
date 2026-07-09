import { alpha, Box, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

interface StatCardProps {
  title: string;
  value: string | number | null;
  icon: React.ReactNode;
  color: string;
  helperText?: string;
  path?: string;
  onClick?: () => void;
}

export default function StatCard({ title, value, icon, color, helperText, path, onClick }: StatCardProps) {
  const navigate = useNavigate();
  const clickable = Boolean(path || onClick);

  return (
    <Paper
      onClick={() => {
        if (path) navigate(path);
        else onClick?.();
      }}
      sx={{
        p: { xs: 1.5, md: 1.75 },
        minHeight: 92,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        position: 'relative',
        overflow: 'hidden',
        cursor: clickable ? 'pointer' : 'default',
        background: `linear-gradient(135deg, ${alpha(color, 0.12)} 0%, ${alpha(color, 0.035)} 100%)`,
        borderColor: alpha(color, 0.2),
        transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
        '&:hover': {
          borderColor: alpha(color, clickable ? 0.42 : 0.22),
          boxShadow: clickable ? `0 10px 26px ${alpha(color, 0.12)}` : undefined,
          transform: clickable ? 'translateY(-1px)' : undefined,
        },
      }}
    >
      <Box
        sx={{
          width: 42,
          height: 42,
          borderRadius: 2,
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'background.paper',
          color,
          flexShrink: 0,
          boxShadow: `0 8px 18px ${alpha(color, 0.14)}`,
          '& svg': { fontSize: 24 },
        }}
      >
        {icon}
      </Box>
      <Stack spacing={0.25} sx={{ minWidth: 0, position: 'relative', zIndex: 1 }}>
        <Typography variant="caption" sx={{ color: alpha(color, 0.88), fontWeight: 900, textTransform: 'uppercase' }}>
          {title}
        </Typography>
        {value === null ? (
          <Skeleton width={72} height={26} />
        ) : (
          <Typography variant="h5" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
            {value}
          </Typography>
        )}
        {helperText ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            {helperText}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}
