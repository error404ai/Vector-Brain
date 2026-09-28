import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { Chip, Tooltip } from '@mui/material';

/**
 * Whether a model can read screenshots of the phone, as the server worked it
 * out from the provider's catalog. It replaces the old "Vision" chip, which
 * showed on every model because the saved type defaults to vision.
 */
export default function ScreenshotCapabilityChip({ seesImages, height = 20 }: { seesImages?: boolean; height?: number }) {
  if (seesImages === undefined) return null;
  const chip = seesImages ? (
    <Chip
      icon={<VisibilityIcon fontSize="inherit" />}
      label="Sees screenshots"
      size="small"
      color="success"
      variant="outlined"
      sx={{ height, fontSize: '0.65rem' }}
    />
  ) : (
    <Chip
      icon={<VisibilityOffIcon fontSize="inherit" />}
      label="Text only"
      size="small"
      variant="outlined"
      sx={{ height, fontSize: '0.65rem', color: 'text.secondary' }}
    />
  );
  return (
    <Tooltip
      title={
        seesImages
          ? 'This model can read screenshots of the phone screen, so it can see icons and pages the element list does not describe.'
          : 'This model cannot read screenshots. It works from the list of on-screen elements only. For screens that list cannot describe, choose a Screen reader model under Agent engine.'
      }
    >
      {chip}
    </Tooltip>
  );
}
