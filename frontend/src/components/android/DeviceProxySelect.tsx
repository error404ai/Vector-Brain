import { proxyColor } from '@/components/android/proxyColors';
import type { DeviceProxy } from '@/RTKService/androidService/proxyService';
import { Box, MenuItem, TextField } from '@mui/material';
import { memo } from 'react';

interface DeviceProxySelectProps {
  deviceId: number;
  value: number | null;
  proxies: DeviceProxy[];
  onChange: (deviceId: number, nextProxyId: number | null) => void;
}

/**
 * The per-card proxy picker, split out and memoized.
 *
 * The fleet page re-renders constantly — every screenshot frame and heartbeat
 * patches state, redrawing all cards a few times a second. When the picker was
 * inline in the card, each of those re-renders tore the open menu down, so the
 * dropdown collapsed mid-click and the user had to try two or three times.
 *
 * Pulling it into a memoized component means it only re-renders when its own
 * inputs (the selected value or the proxy list) actually change — not on every
 * frame — so the menu stays open until the user picks. The change handler is
 * kept stable by the parent (useCallback) so memo isn't defeated by a new
 * function identity each render.
 */
function DeviceProxySelectBase({ deviceId, value, proxies, onChange }: DeviceProxySelectProps) {
  return (
    <Box sx={{ px: 1, pb: 0.5 }}>
      <TextField
        select
        fullWidth
        size="small"
        label="Proxy"
        value={value ?? ''}
        SelectProps={{
          MenuProps: { keepMounted: true, disableScrollLock: true, transitionDuration: 0 },
        }}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(deviceId, raw === '' ? null : Number(raw));
        }}
      >
        <MenuItem value="">No proxy</MenuItem>
        {proxies.map((proxy) => (
          <MenuItem key={proxy.id} value={proxy.id}>
            <Box
              component="span"
              sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: proxyColor(proxy.id), mr: 1, display: 'inline-block' }}
            />
            {proxy.name}
          </MenuItem>
        ))}
      </TextField>
    </Box>
  );
}

const areEqual = (prev: DeviceProxySelectProps, next: DeviceProxySelectProps) =>
  prev.deviceId === next.deviceId &&
  prev.value === next.value &&
  prev.onChange === next.onChange &&
  prev.proxies === next.proxies;

const DeviceProxySelect = memo(DeviceProxySelectBase, areEqual);
export default DeviceProxySelect;
