import { useSendDirectActionMutation } from '@/RTKService/androidService/androidService';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import HomeIcon from '@mui/icons-material/Home';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import SendIcon from '@mui/icons-material/Send';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import { Box, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  /**
   * Stretch to the parent's height instead of imposing a 9:16 box. Used when the
   * screen sits inside a phone mockup that already defines the shape.
   */
  fill?: boolean;
}

/** A tap is anything shorter than this many pixels of movement. */
const TAP_THRESHOLD_PX = 12;

export default function InteractiveDeviceScreen({
  deviceId,
  screenshot,
  onScreenshot,
  controlEnabled,
  isAgentRunning,
  refreshMs = 700,
  compact,
  fill,
}: InteractiveDeviceScreenProps) {
  const [sendDirectAction] = useSendDirectActionMutation();
  const [typeText, setTypeText] = useState('');
  const [showKeyboard, setShowKeyboard] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const pointerStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const busyRef = useRef(false);
  /** True while a tap/swipe is in flight, so frames yield the socket to it. */
  const actionBusyRef = useRef(false);
  /**
   * The phone's real screen width in pixels.
   *
   * Live frames are downscaled previews, so a click measured against the
   * displayed image is in preview pixels — send that to the phone and the tap
   * lands short of where the user pointed. One full-size frame, taken when
   * control is switched on, gives the true width to scale by.
   */
  const deviceWidthRef = useRef<number | null>(null);

  // Parents often pass an inline callback. Keeping it in a ref stops the polling
  // effect from tearing down and restarting on every render.
  const onScreenshotRef = useRef(onScreenshot);
  useEffect(() => {
    onScreenshotRef.current = onScreenshot;
  }, [onScreenshot]);

  /**
   * Pulls one frame. Skips if a previous pull is still in flight, or if the user
   * is mid-action: the phone has a single socket, so a full-size frame in flight
   * delays the tap behind it. Live frames are small previews for the same reason.
   */
  const captureFrame = useCallback(async () => {
    if (!deviceId || busyRef.current || actionBusyRef.current) return;
    busyRef.current = true;
    try {
      const res = await sendDirectAction({
        device_id: deviceId,
        action: { type: 'CaptureScreen', preview: true, awaitStability: false },
      }).unwrap();
      const base64 = res?.data?.screenCapture?.base64Data;
      if (base64) onScreenshotRef.current?.(base64);
    } catch {
      // A dropped frame is not worth surfacing; the next tick retries.
    } finally {
      busyRef.current = false;
    }
  }, [deviceId, sendDirectAction]);

  /** One full-resolution frame, purely to learn the device's real width. */
  const measureDevice = useCallback(async () => {
    if (!deviceId) return;
    try {
      const res = await sendDirectAction({
        device_id: deviceId,
        action: { type: 'CaptureScreen', awaitStability: false },
      }).unwrap();
      const snapshot = res?.data?.screenCapture;
      if (snapshot?.width) deviceWidthRef.current = snapshot.width;
      if (snapshot?.base64Data) onScreenshotRef.current?.(snapshot.base64Data);
    } catch {
      // Without it taps are unscaled — the same behaviour as before previews.
    }
  }, [deviceId, sendDirectAction]);

  // ---- Live frames -------------------------------------------------------
  // Paced by the phone rather than by a fixed interval: the next frame is asked
  // for once the previous one has arrived. A fixed timer on a slow link just
  // queues requests the device cannot answer yet, which is what made the feed
  // stutter and manual taps feel late.
  useEffect(() => {
    if (!controlEnabled || !deviceId) return;
    let stopped = false;
    let timer: number | undefined;

    const loop = async () => {
      if (stopped) return;
      if (deviceWidthRef.current === null) await measureDevice();
      if (stopped) return;
      await captureFrame();
      if (stopped) return;
      timer = window.setTimeout(loop, Math.max(refreshMs, 120));
    };
    void loop();

    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [controlEnabled, deviceId, refreshMs, captureFrame, measureDevice]);

  useEffect(() => {
    deviceWidthRef.current = null;
  }, [deviceId]);

  // ---- Coordinate mapping ------------------------------------------------
  /**
   * Converts a browser click into device pixels. The image is rendered with
   * `object-fit: contain`, so the drawn area is letterboxed inside the box and
   * the offsets have to be removed before scaling.
   */
  const toDeviceCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) {
      toast.error('Screen not measured yet — wait for a frame and try again');
      return null;
    }

    const rect = img.getBoundingClientRect();
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const drawnW = img.naturalWidth * scale;
    const drawnH = img.naturalHeight * scale;
    const offsetX = (rect.width - drawnW) / 2;
    const offsetY = (rect.height - drawnH) / 2;

    // Clamp instead of dropping: clicks on the letterbox edge should still land.
    const localX = Math.min(Math.max(clientX - rect.left - offsetX, 0), drawnW);
    const localY = Math.min(Math.max(clientY - rect.top - offsetY, 0), drawnH);

    // The displayed frame is a preview; the phone taps in its own pixels.
    const preview = deviceWidthRef.current && img.naturalWidth ? deviceWidthRef.current / img.naturalWidth : 1;

    return { x: Math.round((localX / scale) * preview), y: Math.round((localY / scale) * preview) };
  };

  const runAction = async (action: Record<string, unknown>, label: string) => {
    if (!deviceId) return;
    actionBusyRef.current = true;
    try {
      const res = await sendDirectAction({ device_id: deviceId, action }).unwrap();
      const base64 = res?.data?.screenCapture?.base64Data;
      if (base64) onScreenshotRef.current?.(base64);

      // Most actions return no frame, so pull one right away rather than waiting
      // for the next tick. The short delay lets the UI settle first.
      window.setTimeout(() => {
        actionBusyRef.current = false;
        void captureFrame();
      }, 250);
    } catch (error) {
      actionBusyRef.current = false;
      const message = (error as { data?: { message?: string } })?.data?.message;
      toast.error(message ? `${label}: ${message}` : `${label} failed`);
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
    <Stack gap={1} sx={fill ? { height: '100%', width: '100%' } : undefined}>
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
          bgcolor: fill ? 'transparent' : 'grey.900',
          ...(fill ? { flexGrow: 1, minHeight: 0 } : { aspectRatio: '9 / 16' }),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          outline: interactive ? '2px solid' : 'none',
          outlineColor: 'primary.main',
        }}
      >
        {screenshot ? (
          <img
            ref={imgRef}
            src={`data:image/jpeg;base64,${screenshot}`}
            alt="Device screen"
            draggable={false}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            style={{
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
