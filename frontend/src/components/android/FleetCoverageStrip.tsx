import type { AndroidDevice } from '@/RTKService/androidService/androidService';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { useMemo } from 'react';

/**
 * Turns whatever the companion app reported into one short, groupable label.
 *
 * Devices send this field in several shapes — "13", "13.0", and (on this fleet)
 * the already-prefixed "Android 17 (API 37)". Prefixing blindly produced
 * "Android Android 17 (API 37)", so the version number is extracted instead of
 * assumed.
 */
function versionLabel(raw?: string): string {
  const value = (raw || '').trim();
  if (!value) return 'Unknown';
  const match = value.match(/(\d+)/);
  return match ? `Android ${match[1]}` : value;
}

interface FleetCoverageStripProps {
  devices: AndroidDevice[];
}

/**
 * What the fleet actually covers, as one bar.
 *
 * A list of phones tells you how many you own. It does not tell you the thing
 * that matters when the fleet is the product: which Android versions you can
 * test on, and where the holes are. Every field this needs is already stored on
 * the device record, so this is reading data that was being collected and
 * ignored.
 *
 * Segments are proportional, so a fleet that is nine phones on one version and
 * one on another looks lopsided at a glance — which is the point.
 */
export default function FleetCoverageStrip({ devices }: FleetCoverageStripProps) {
  const segments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const device of devices) {
      counts.set(versionLabel(device.android_version), (counts.get(versionLabel(device.android_version)) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => {
        const na = Number(a[0].replace(/\D/g, ''));
        const nb = Number(b[0].replace(/\D/g, ''));
        if (!na) return 1;
        if (!nb) return -1;
        return nb - na;
      })
      .map(([label, count]) => ({ label, count }));
  }, [devices]);

  if (!devices.length) return null;

  const total = devices.length;

  // Older versions sit further along the ramp, so the fleet reads left-to-right
  // from newest to oldest without needing a legend.
  const shade = (index: number) => {
    // Adjacent shades of one hue are indistinguishable in a 10px bar, so the
    // ramp steps through hue as well as lightness.
    const stops = ['#1d4ed8', '#0891b2', '#7c3aed', '#0d9488', '#c2410c', '#64748b'];
    return stops[Math.min(index, stops.length - 1)];
  };

  return (
    <Box sx={{ mb: 2.5 }}>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.75 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
          Coverage
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {segments.length} {segments.length === 1 ? 'version' : 'versions'} across {total}{' '}
          {total === 1 ? 'device' : 'devices'}
        </Typography>
      </Stack>

      <Stack direction="row" sx={{ height: 10, borderRadius: 5, overflow: 'hidden', bgcolor: 'action.hover' }}>
        {segments.map((segment, index) => (
          <Tooltip key={segment.label} title={`${segment.label} — ${segment.count}`} arrow>
            <Box
              sx={{
                flexGrow: segment.count,
                flexBasis: 0,
                bgcolor: segment.label === 'Unknown' ? 'grey.400' : shade(index),
                transition: 'flex-grow 400ms ease',
                '&:not(:last-of-type)': { borderRight: '2px solid', borderColor: 'background.paper' },
              }}
            />
          </Tooltip>
        ))}
      </Stack>

      <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{ mt: 1 }}>
        {segments.map((segment, index) => (
          <Stack key={segment.label} direction="row" spacing={0.75} alignItems="center">
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: segment.label === 'Unknown' ? 'grey.400' : shade(index),
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {segment.label} · {segment.count}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
