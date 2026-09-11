import type { TelegramLinkCode } from '@/RTKService/telegramService/telegramService';
import {
  useCreateTelegramLinkCodeMutation,
  useGetTelegramStatusQuery,
  useUnlinkTelegramMutation,
} from '@/RTKService/telegramService/telegramService';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import {
  Alert,
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

interface PendingLink {
  code: TelegramLinkCode;
  /** linkedAt before the code was made, so a stale "linked" is not mistaken for success. */
  baselineLinkedAt: string | null;
}

/**
 * Connect a Telegram chat to this account.
 *
 * The dashboard hands out a one-time code; the user sends it to the bot, and
 * the bot ties that chat to the account. While a code is out, status is polled
 * so the card flips to "connected" on its own.
 */
export default function TelegramLinkCard() {
  const theme = useTheme();
  const [pending, setPending] = useState<PendingLink | null>(null);
  const { data, isLoading, refetch } = useGetTelegramStatusQuery(undefined, { pollingInterval: pending ? 3000 : 0 });
  const [createCode, { isLoading: isCreating }] = useCreateTelegramLinkCodeMutation();
  const [unlink, { isLoading: isUnlinking }] = useUnlinkTelegramMutation();

  const status = data?.data;
  const linked = Boolean(status?.linked);
  const linkedAt = status?.linkedAt ?? null;

  useEffect(() => {
    if (pending && linked && linkedAt !== pending.baselineLinkedAt) {
      setPending(null);
      toast.success('Telegram connected');
    }
  }, [pending, linked, linkedAt]);

  const codeExpired = pending ? Date.parse(pending.code.expiresAt) < Date.now() : false;
  /** The code still worth showing, if any. */
  const activeCode: TelegramLinkCode | null = pending && !codeExpired ? pending.code : null;
  const botName = pending?.code.botUsername ?? status?.botUsername ?? null;
  const telegramUsername = status?.telegramUsername ?? null;

  const handleConnect = async () => {
    try {
      const res = await createCode().unwrap();
      setPending({ code: res.data, baselineLinkedAt: linkedAt });
    } catch (err: any) {
      toast.error(err?.data?.message || 'Could not create a link code');
    }
  };

  const handleUnlink = async () => {
    if (!confirm('Disconnect Telegram? The chat will no longer be able to control your phones.')) return;
    try {
      await unlink().unwrap();
      setPending(null);
      refetch();
      toast.success('Telegram disconnected');
    } catch (err: any) {
      toast.error(err?.data?.message || 'Could not disconnect Telegram');
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed — select the code and copy it manually');
    }
  };

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2, md: 3 },
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        transition: 'border-color 220ms ease, box-shadow 220ms ease',
        '&:hover': {
          borderColor: alpha(theme.palette.primary.main, 0.35),
          boxShadow: `0 10px 30px ${alpha(theme.palette.primary.main, 0.08)}`,
        },
      }}
    >
      <Stack spacing={2.5}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2.5,
              display: 'grid',
              placeItems: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: 'primary.main',
            }}
          >
            <SendIcon />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={600}>
              Telegram bot
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Run tasks, check status and get results on your phones from Telegram.
            </Typography>
          </Box>
        </Stack>

        {isLoading ? (
          <CircularProgress size={24} />
        ) : !status?.enabled ? (
          <Alert severity="info">The Telegram bot is not set up on this server yet.</Alert>
        ) : linked ? (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip
              color="success"
              variant="outlined"
              label={telegramUsername ? `Connected as @${telegramUsername}` : 'Connected'}
            />
            {botName && (
              <Typography variant="body2" color="text.secondary">
                Chat with @{botName} and send /help.
              </Typography>
            )}
            <Button color="error" size="small" onClick={handleUnlink} disabled={isUnlinking} sx={{ ml: 'auto' }}>
              Disconnect
            </Button>
          </Stack>
        ) : activeCode ? (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h5" fontWeight={700} sx={{ fontFamily: 'monospace', letterSpacing: 2 }}>
                {activeCode.code}
              </Typography>
              <Tooltip title="Copy /link command">
                <IconButton size="small" onClick={() => handleCopy(`/link ${activeCode.code}`)}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              {activeCode.deepLink && (
                <Button variant="contained" href={activeCode.deepLink} target="_blank" rel="noopener noreferrer">
                  Open in Telegram
                </Button>
              )}
              <Typography variant="body2" color="text.secondary">
                {activeCode.deepLink ? 'or send ' : 'Send '}
                <b>/link {activeCode.code}</b>
                {botName ? ` to @${botName}` : ' to the bot'}. The code works for 10 minutes.
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={14} />
              <Typography variant="caption" color="text.secondary">
                Waiting for the bot…
              </Typography>
            </Stack>
          </Stack>
        ) : (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={handleConnect} disabled={isCreating}>
              {codeExpired ? 'Code expired — get a new one' : 'Connect Telegram'}
            </Button>
            <Typography variant="body2" color="text.secondary">
              You get a one-time code to send to the bot.
            </Typography>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
