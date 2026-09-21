import { useGetAndroidTasksQuery } from '@/RTKService/androidService/androidService';
import HistoryIcon from '@mui/icons-material/History';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Starting points for someone who has not run anything yet. */
const SUGGESTIONS = [
  'Open YouTube and play lofi study music',
  'Open Chrome and search for the weather today',
  'Open the Play Store and check for app updates',
  'Open date and time settings',
  'Open bbc.com and tell me the top 3 headlines',
  'Take me to the home screen and open the app drawer',
];

/** Past prompts pulled per open. Enough to be useful, not enough to scroll forever. */
const HISTORY_LIMIT = 50;
const HISTORY_SHOWN = 8;

interface PromptOption {
  value: string;
  kind: 'history' | 'suggestion';
}

interface FleetPromptFieldProps {
  /** Called with the typed text when the user submits. */
  onSubmit: (value: string) => void;
  /**
   * Bumped by the parent after a successful run started from the page's Run
   * button. The field clears when it changes, so the box empties whether the
   * task was sent with Enter here or with the button outside.
   */
  resetSignal?: number;
  /**
   * Debounced copy of the draft, for the page's Run button.
   *
   * Deliberately not per keystroke: the page only needs to know whether the box
   * is empty, and telling it on every character is what made typing stall.
   */
  onDraftChange?: (value: string) => void;
  placeholder?: string;
}

/**
 * The fleet's task box, with what has been run before behind it.
 *
 * Typing the same instruction again is the most common thing anyone does here,
 * so previous prompts come first and the canned examples sit underneath as a
 * fallback for an empty account. Free text is still the point — the list only
 * saves typing, it never restricts what can be sent.
 */
export default function FleetPromptField({ onSubmit, onDraftChange, placeholder, resetSignal }: FleetPromptFieldProps) {
  /**
   * The draft lives here rather than on the page.
   *
   * The fleet page renders a card per device, each holding a screenshot, so
   * lifting this state up meant every keystroke redrew all of them and typing
   * visibly stalled. Nothing outside this field needs the text until it is sent.
   */
  const [value, setValue] = useState('');
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDraft = (next: string) => {
    setValue(next);
    if (!onDraftChange) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => onDraftChange(next), 300);
  };

  useEffect(() => () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
  }, []);

  // Parent signalled a run started elsewhere (the Run button) — empty the box.
  useEffect(() => {
    if (resetSignal === undefined) return;
    setValue('');
    onDraftChange?.('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);
  // Already cached by RTK for the tasks page, so this rarely costs a request.
  const { data } = useGetAndroidTasksQuery({ limit: HISTORY_LIMIT });

  const options = useMemo<PromptOption[]>(() => {
    const seen = new Set<string>();
    const history: PromptOption[] = [];

    for (const task of data?.data ?? []) {
      const prompt = (task.prompt || '').trim();
      // Newest first, and the same instruction run twice should appear once.
      if (!prompt || seen.has(prompt.toLowerCase())) continue;
      seen.add(prompt.toLowerCase());
      history.push({ value: prompt, kind: 'history' });
      if (history.length >= HISTORY_SHOWN) break;
    }

    const suggestions = SUGGESTIONS.filter((suggestion) => !seen.has(suggestion.toLowerCase())).map(
      (suggestion): PromptOption => ({ value: suggestion, kind: 'suggestion' }),
    );

    return [...history, ...suggestions];
  }, [data]);

  return (
    <Autocomplete
      freeSolo
      fullWidth
      openOnFocus
      disableClearable
      options={options}
      inputValue={value}
      onInputChange={(_event, next) => setDraft(next)}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.value)}
      groupBy={(option) => (option.kind === 'history' ? 'Recent' : 'Try one of these')}
      filterOptions={(list, state) => {
        const query = state.inputValue.trim().toLowerCase();
        if (!query) return list;
        return list.filter((option) => option.value.toLowerCase().includes(query));
      }}
      renderOption={(props, option) => (
        <Box component="li" {...props} key={`${option.kind}-${option.value}`} sx={{ gap: 1 }}>
          {option.kind === 'history' ? (
            <HistoryIcon fontSize="small" sx={{ color: 'text.disabled' }} />
          ) : (
            <LightbulbIcon fontSize="small" sx={{ color: 'text.disabled' }} />
          )}
          <Typography variant="body2" noWrap>
            {option.value}
          </Typography>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          placeholder={placeholder ?? 'e.g. Open YouTube and search for lofi beats'}
          onKeyDown={(event) => {
            // Enter while the list is open picks an option; Autocomplete has
            // already handled it by then, so only a plain Enter submits.
            if (event.key === 'Enter' && !event.shiftKey && !event.defaultPrevented) {
              event.preventDefault();
              const submitted = value.trim();
              if (!submitted) return;
              onSubmit(submitted);
              // Clear immediately so the box doesn't look like nothing happened.
              setValue('');
              onDraftChange?.('');
            }
          }}
        />
      )}
    />
  );
}
