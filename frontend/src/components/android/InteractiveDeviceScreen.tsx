import { useSendDirectActionMutation } from '@/RTKService/androidService/androidService';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import HomeIcon from '@mui/icons-material/Home';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import SendIcon from '@mui/icons-material/Send';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import { Box, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

interface InteractiveDeviceScreenProps {
  deviceId?: number;
  screenshot?: string | null;
  /** Called whenever a fresh frame is pulled so the parent can keep its own copy. */
  onScreenshot?: (base64: string) => void;
  /** Turns interaction and live polling on. */
  controlEnabled: boolean;
  /** An agent task is executing on this device right now. */
  isAgentRunning?: boolean;
  /** Milliseconds between frame refreshes while control is on. */
  refreshMs?: number;
  /** Compact variant hides the on-screen keyboard row (used on fleet cards). */
  compact?: boolean;
}

/** A tap is anything shorter than this many pixels of movement. */
const TAP_THRESHOLD_PX = 12;

export default function InteractiveDeviceScreen({
  deviceId,
  screenshot,
  onScreenshot,
  controlEnabled,
  isAgentRunning,
  refreshMs = 1500,
  compact,
}: InteractiveDeviceScreenProps) {
  const [sendDirectAction] = useSendDirectActionMutation();
  const [typeText, setTypeText] = useState('');
  const [showKeyboard, setShowKeyboard] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const pointerStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const busyRef = useRef(false);

  // ---- Live frames -------------------------------------------------------
  useEffect(() => {
    if (!controlEnabled || !deviceId) return;

    let cancelled = false;

    const pull = async () => {
      // Never queue frames on top of each other on a slow link.
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const res = await sendDirectAction({ device_id: deviceId, action: { type: 'CaptureScreen' } }).unwrap();
        const base64 = res?.data?.screenCapture?.base64Data;
        if (base64 && !cancelled) onScreenshot?.(base64);
      } catch {
        // A dropped frame is not worth surfacing; the next tick retries.
      } finally {
        busyRef.current = false;
      }
    };

    pull();
    const timer = setInterval(pull, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [controlEnabled, deviceId, refreshMs, sendDirectAction, onScreenshot]);

  // ---- Coordinate mapping ------------------------------------------------
  /**
   * Converts a browser click into device pixels. The image is rendered with
   * `object-fit: contain`, so the drawn area is letterboxed inside the box and
   * the offsets have to be removed before scaling.
   */
  const toDeviceCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;

    const rect = img.getBoundingClientRect();
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const drawnW = img.naturalWidth * scale;
    const drawnH = img.naturalHeight * scale;
    const offsetX = (rect.width - drawnW) / 2;
    const offsetY = (rect.height - drawnH) / 2;

    const localX = clientX - rect.left - offsetX;
    const localY = clientY - rect.top - offsetY;
    if (localX < 0 || localY < 0 || localX > drawnW || localY > drawnH) return null;

    return { x: Math.round(localX / scale), y: Math.round(localY / scale) };
  };

  const runAction = async (action: Record<string, unknown>, label: string) => {
    if (!deviceId) return;
    try {
      const res = await sendDirectAction({ device_id: deviceId, action }).unwrap();
      const base64 = res?.data?.screenCapture?.base64Data;
      if (base64) onScreenshot?.(base64);
    } catch {
      toast.error(`${label} failed`);
    }
  };

  // ---- Pointer handling --------------------------------------------------
  const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!controlEnabled) return;
    pointerStart.current = { x: event.clientX, y: event.clientY, t: Date.now() };
  };

  const handlePointerUp = async (event: React.PointerEvent<HTMLImageElement>) => {
    if (!controlEnabled) return;
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;

    const from = toDeviceCoords(start.x, start.y);
    const to = toDeviceCoords(event.clientX, event.clientY);
    if (!from || !to) return;

    const movedPx = Math.hypot(event.clientX - start.x, event.clientY - start.y);

    if (movedPx < TAP_THRESHOLD_PX) {
      await runAction({ type: 'Tap', x: from.x, y: from.y }, 'Tap');
      return;
    }

    // Map the drag onto the closest cardinal swipe the protocol supports.
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const direction =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'RIGHT' : 'LEFT') : dy > 0 ? 'DOWN' : 'UP';

    await runAction(
      { type: 'Swipe', direction, durationMillis: Math.max(200, Math.min(800, Date.now() - start.t)) },
      'Swipe',
    );
  };

  const handleSendText = async () => {
    const text = typeText.trim();
    if (!text) return;
    await runAction({ type: 'SetText', text }, 'Typing');
    setTypeText('');
  };

  const interactive = controlEnabled && Boolean(deviceId);

  return (
    <Stack gap={1}>
      {/* Warning while the agent is also driving this device */}
      {interactive && isAgentRunning && (
        <Typography
          variant="caption"
          sx={{
            px: 1,
            py: 0.5,
            borderRadius: 1,
            bgcolor: 'warning.light',
            color: 'warning.contrastText',
            fontWeight: 600,
          }}
        >
          Agent is running — your taps go to the same screen and may confuse it. Useful for CAPTCHAs and logins.
        </Typography>
      )}

      {/* Screen */}
      <Box
        sx={{
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: 'grey.900',
          aspectRatio: '9 / 16',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          outline: interactive ? '2px solid' : 'none',
          outlineColor: 'primary.main',
        }}
      >
        {screenshot ? (
          <Box
            component="img"
            ref={imgRef}
            src={`data:image/jpeg;base64,${screenshot}`}
            alt="Device screen"
            draggable={false}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            sx={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              cursor: interactive ? 'crosshair' : 'default',
              touchAction: 'none',
              userSelect: 'none',
            }}
          />
        ) : (
          <Stack alignItems="center" gap={1} sx={{ color: 'grey.500' }}>
            <PhoneAndroidIcon />
            <Typography variant="caption">
              {interactive ? 'Waiting for the first frame…' : 'No frame yet'}
            </Typography>
          </Stack>
        )}

        {interactive && (
          <Tooltip title="Click to tap · drag to swipe">
            <TouchAppIcon
              fontSize="small"
              sx={{ position: 'absolute', top: 6, right: 6, color: 'primary.light', opacity: 0.9 }}
            />
          </Tooltip>
        )}
      </Box>

      {/* Navigation + keyboard */}
      {interactive && (
        <Stack direction="row" alignItems="center" gap={0.5} justifyContent="center">
          <Tooltip title="Back">
            <IconButton size="small" onClick={() => runAction({ type: 'Global', action: 'BACK' }, 'Back')}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Home">
            <IconButton size="small" onClick={() => runAction({ type: 'Global', action: 'HOME' }, 'Home')}>
              <HomeIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Recents">
            <IconButton size="small" onClick={() => runAction({ type: 'Global', action: 'RECENTS' }, 'Recents')}>
              <CropSquareIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {!compact && (
            <Tooltip title="Type text">
              <IconButton
                size="small"
                color={showKeyboard ? 'primary' : 'default'}
                onClick={() => setShowKeyboard((prev) => !prev)}
              >
                <KeyboardIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      )}

      {interactive && showKeyboard && !compact && (
        <Stack direction="row" gap={0.75}>
          <TextField
            fullWidth
            size="small"
            placeholder="Type into the focused field…"
            value={typeText}
            onChange={(event) => setTypeText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSendText();
              }
            }}
          />
          <IconButton size="small" color="primary" disabled={!typeText.trim()} onClick={handleSendText}>
            <SendIcon fontSize="small" />
          </IconButton>
        </Stack>
      )}
    </Stack>
  );
}
