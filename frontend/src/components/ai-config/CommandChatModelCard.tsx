import {
  useGetAiConfigsQuery,
  useSetChatDefaultAiConfigMutation,
  type AiConfig,
} from '@/RTKService/aiConfigService/aiConfigService';
import { isFreeModel } from '@/components/ai-config/ActiveProviderHero';
import ChatIcon from '@mui/icons-material/ChatBubbleOutline';
import { Alert, Box, FormControl, MenuItem, Paper, Select, Stack, Typography } from '@mui/material';
import toast from 'react-hot-toast';

/**
 * Picks the model the Command chat uses, kept separate from the fleet model the
 * phones run. The chat needs a dependable model; a free one hits its per-day
 * cap and stalls the chat, so free models are called out and can't be chosen.
 */
export default function CommandChatModelCard() {
  const { data } = useGetAiConfigsQuery();
  const configs: AiConfig[] = data?.data ?? [];
  const [setChatDefault, { isLoading }] = useSetChatDefaultAiConfigMutation();

  const chosen = configs.find((c) => c.is_chat_default);
  // A free model here would keep failing, so it isn't offered.
  const selectable = configs.filter((c) => !isFreeModel(c.model));
  const chosenIsFree = chosen && isFreeModel(chosen.model);

  const onPick = async (id: number) => {
    try {
      await setChatDefault(id).unwrap();
      toast.success('Command chat model updated');
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message || 'Could not set the chat model');
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <ChatIcon fontSize="small" color="primary" />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Command chat model
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The model that reads your chat messages on Mission Control. Kept separate from the model your phones run.
        Don't use a free model here — its daily limit will stall the chat.
      </Typography>

      {selectable.length === 0 ? (
        <Alert severity="warning" variant="outlined">
          Add a paid AI provider above first, then choose it here.
        </Alert>
      ) : (
        <FormControl size="small" fullWidth>
          <Select
            displayEmpty
            value={chosen && !chosenIsFree ? String(chosen.id) : ''}
            disabled={isLoading}
            onChange={(event) => event.target.value && onPick(Number(event.target.value))}
            renderValue={(value) =>
              value ? configs.find((c) => String(c.id) === value)?.model : <Box component="span" sx={{ color: 'text.secondary' }}>Choose a model…</Box>
            }
          >
            {selectable.map((config) => (
              <MenuItem key={config.id} value={String(config.id)}>
                {config.model}
                {config.label ? ` · ${config.label}` : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {chosenIsFree && (
        <Alert severity="warning" variant="outlined" sx={{ mt: 1.5 }}>
          The current chat model is a free model and will hit its daily limit. Pick a paid one above.
        </Alert>
      )}
    </Paper>
  );
}
