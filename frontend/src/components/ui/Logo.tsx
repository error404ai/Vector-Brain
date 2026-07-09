import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { Box, Stack, Typography } from '@mui/material';

interface LogoProps {
  size?: number;
  showText?: boolean;
}

export function Logo({ size = 34, showText = true }: LogoProps) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          width: size,
          height: size,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          borderRadius: 2,
          color: '#ffffff',
          bgcolor: 'primary.main',
          boxShadow: '0 10px 22px rgba(37, 99, 235, 0.22)',
        }}
      >
        <AutoAwesomeIcon sx={{ fontSize: Math.round(size * 0.58) }} />
      </Box>
      {showText ? (
        <Typography
          variant="subtitle1"
          noWrap
          sx={{
            fontWeight: 900,
            color: 'text.primary',
            letterSpacing: 0,
          }}
        >
          Vector Brain
        </Typography>
      ) : null}
    </Stack>
  );
}

export default Logo;
