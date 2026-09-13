import { useSendDirectActionMutation } from '@/RTKService/androidService/androidService';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HomeIcon from '@mui/icons-material/Home';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardReturnIcon from '@mui/icons-material/KeyboardReturn';
import NotificationsIcon from '@mui/icons-material/Notifications';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewAgendaIcon from '@mui/icons-material/ViewAgenda';
import { CircularProgress, IconButton, Stack, Tooltip } from '@mui/material';
import type { ReactNode } from 'react';
import { useState } from 'react';
import toast from 'react-hot-toast';

/** Matches the device action union the backend accepts. */
type DeviceAction = Record<string, unknown>;

interface Control {
  key: string;
  label: string;
  icon: ReactNode;
  action: DeviceAction;
  /** Shown in the compact per-device row. The rest are extras. */
  primary?: boolean;
  /** True when the result is a new frame the caller should display. */
  returnsFrame?: boolean;
}

const CONTROLS: Control[] = [
  { key: 'back', label: 'Back', icon: <ArrowBackIcon fontSize="inherit" />, action: { type: 'Global', action: 'BACK' }, primary: true },
  { key: 'home', label: 'Home', icon: <HomeIcon fontSize="inherit" />, action: { type: 'Global', action: 'HOME' }, primary: true },
  { key: 'recents', label: 'Recent apps', icon: <ViewAgendaIcon fontSize="inherit" />, action: { type: 'Global', action: 'RECENTS' }, primary: true },
  { key: 'notifications', label: 'Notification shade', icon: <NotificationsIcon fontSize="inherit" />, action: { type: 'Global', action: 'NOTIFICATIONS' } },
  // Direction is the way the finger drags, not the way the page moves: UP
  // reveals what is further down. The arrows follow the page, so they are
  // paired with the opposite drag.
  { key: 'down', label: 'Scroll down', icon: <KeyboardArrowDownIcon fontSize="inherit" />, action: { type: 'Swipe', direction: 'UP' } },
  { key: 'up', label: 'Scroll up', icon: <KeyboardArrowUpIcon fontSize="inherit" />, action: { type: 'Swipe', direction: 'DOWN' } },
  { key: 'enter', label: 'Press Enter', icon: <KeyboardReturnIcon fontSize="inherit" />, action: { type: 'PressKey', key: 'ENTER' } },
  { key: 'refresh', label: 'Refresh screen', icon: <RefreshIcon fontSize="inherit" />, action: { type: 'CaptureScreen' }, primary: true, returnsFrame: true },
];

interface DeviceControlsProps {
  /** Device ids each press is sent to. One for a card, many for a selection. */
  deviceIds: number[];
  /** Called with a fresh frame, per device, when one comes back. */
  onFrame?: (deviceId: number, base64: string) => void;
  /** Compact shows only the primary controls; full shows everything. */
  variant?: 'compact' | 'full';
  disabled?: boolean;
}

/**
 * One-tap phone controls.
 *
 * The same component drives a single card and a whole selection, because the
 * only difference is how many ids a press goes to. What is here is limited to
 * what the accessibility service can genuinely do — there is no power, reboot or
 * volume, since Android does not expose those to a service.
 */
export default function DeviceControls({ deviceIds, onFrame, variant = 'compact', disabled }: DeviceControlsProps) {
  const [sendDirectAction] = useSendDirectActionMutation();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const controls = variant === 'compact' ? CONTROLS.filter((control) => control.primary) : CONTROLS;

  const press = async (control: Control) => {
    if (deviceIds.length === 0) return toast.error('No device selected');
    setBusyKey(control.key);

    let ok = 0;
    try {
      // Four at a time: a press that returns a frame sends a full screenshot
      // back up, and twenty of those at once starves the phones' uplink.
      const BATCH = 4;
      for (let start = 0; start < deviceIds.length; start += BATCH) {
        const batch = deviceIds.slice(start, start + BATCH);
        const results = await Promise.allSettled(
          batch.map(async (deviceId) => {
            const response = await sendDirectAction({ device_id: deviceId, action: control.action }).unwrap();
            const frame = response?.data?.screenCapture?.base64Data;
            if (frame && onFrame) onFrame(deviceId, frame);
            return true;
          }),
        );
        ok += results.filter((result) => result.status === 'fulfilled').length;
      }

      if (ok === 0) toast.error(`${control.label} failed`);
      else if (ok < deviceIds.length) toast.success(`${control.label}: ${ok} of ${deviceIds.length}`);
      else if (deviceIds.length > 1) toast.success(`${control.label} sent to ${ok} devices`);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Stack direction="row" gap={0.25} flexWrap="wrap" useFlexGap>
      {controls.map((control) => (
        <Tooltip key={control.key} title={control.label}>
          <span>
            <IconButton
              size="small"
              disabled={disabled || busyKey !== null || deviceIds.length === 0}
              onClick={() => void press(control)}
              sx={{ fontSize: 18 }}
            >
              {busyKey === control.key ? <CircularProgress size={15} /> : control.icon}
            </IconButton>
          </span>
        </Tooltip>
      ))}
    </Stack>
  );
}
