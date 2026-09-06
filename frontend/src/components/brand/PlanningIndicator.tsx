import VectorMark from '@/components/brand/VectorMark';
import { Box, Stack, Typography } from '@mui/material';

interface PlanningIndicatorProps {
  /** Short line describing what the agent is doing right now. */
  label?: string;
}

/**
 * Fills the gap between pressing Send and the first step arriving.
 *
 * That wait is ten to thirty seconds of nothing while the planner works, which
 * is long enough for someone to wonder whether the click registered. Showing the
 * mark doing exactly what the agent is doing answers that, and is the one place
 * in the product where the brand gets a moment of its own.
 */
export default function PlanningIndicator({ label = 'Reading the screen and writing a plan' }: PlanningIndicatorProps) {
  return (
    <Stack
      direction="row"
      spacing={1.75}
      alignItems="center"
      sx={{
        px: 1.75,
        py: 1.5,
        mb: 1.5,
        borderRadius: 2,
        bgcolor: 'action.hover',
      }}
    >
      <VectorMark size={38} animated />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Steps appear here as they run
        </Typography>
      </Box>
    </Stack>
  );
}
