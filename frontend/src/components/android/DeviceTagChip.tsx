import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import { Box, Button, Popover, Stack, TextField, Tooltip, Typography, alpha } from '@mui/material';
import { memo, useEffect, useState, type MouseEvent } from 'react';

/** The eight tag colours. Keys are what gets stored, so keep them short. */
export const TAG_COLORS = {
  rose: '#e11d48',
  orange: '#ea580c',
  amber: '#ca8a04',
  green: '#16a34a',
  cyan: '#0891b2',
  blue: '#2563eb',
  violet: '#7c3aed',
  slate: '#6b7280',
} as const;

export type TagColor = keyof typeof TAG_COLORS;

/** Short on purpose: a tag is a glanceable label on a card header, not a note. */
const MAX_TAG_LENGTH = 10;

export interface ParsedTag {
  color: TagColor;
  text: string;
}

/**
 * Tags are stored in the device's existing `tag` column as `color:text`, so no
 * backend change was needed. Anything without a known colour prefix is an older
 * free-text note — shown as a grey tag rather than dropped.
 */
export function parseTag(raw: string | null | undefined): ParsedTag | null {
  if (!raw) return null;
  const match = /^([a-z]+):(.*)$/.exec(raw);
  if (match && match[1] in TAG_COLORS) {
    const text = match[2].trim();
    return text ? { color: match[1] as TagColor, text } : null;
  }
  return { color: 'slate', text: raw };
}

interface DeviceTagChipProps {
  tag: string | null | undefined;
  /** Persists the encoded tag ('' removes it). Resolves false if the save failed. */
  onSave: (encoded: string) => Promise<boolean>;
}

function DeviceTagChipBase({ tag, onSave }: DeviceTagChipProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftColor, setDraftColor] = useState<TagColor>('blue');
  // Shown straight after Save so the card updates instantly; cleared once the
  // device list catches up with the real value.
  const [optimistic, setOptimistic] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setOptimistic(undefined);
  }, [tag]);

  const current = parseTag(optimistic !== undefined ? optimistic : tag);

  const open = (event: MouseEvent<HTMLElement>) => {
    setDraftText((current?.text ?? '').slice(0, MAX_TAG_LENGTH));
    setDraftColor(current?.color ?? 'blue');
    setAnchor(event.currentTarget);
  };

  const commit = async (encoded: string) => {
    setAnchor(null);
    setOptimistic(encoded || null);
    const ok = await onSave(encoded);
    if (!ok) setOptimistic(undefined);
  };

  const save = () => {
    const text = draftText.trim().slice(0, MAX_TAG_LENGTH);
    void commit(text ? `${draftColor}:${text}` : '');
  };

  const chip = current ? (
    <Tooltip title="Edit tag">
      <Box
        component="button"
        type="button"
        onClick={open}
        sx={{
          border: 'none',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.4,
          px: 0.9,
          py: '2px',
          borderRadius: 1.5,
          fontSize: 11.5,
          fontWeight: 700,
          lineHeight: '17px',
          maxWidth: 120,
          flexShrink: 0,
          color: '#fff',
          bgcolor: TAG_COLORS[current.color],
          boxShadow: `0 1px 4px ${alpha(TAG_COLORS[current.color], 0.35)}`,
          '&:hover': { filter: 'brightness(1.08)' },
        }}
      >
        <LocalOfferIcon sx={{ fontSize: 12 }} />
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current.text}
        </Box>
      </Box>
    </Tooltip>
  ) : (
    <Box
      component="button"
      type="button"
      onClick={open}
      sx={{
        cursor: 'pointer',
        px: 1,
        py: '1px',
        borderRadius: 5,
        fontSize: 11.5,
        lineHeight: '16px',
        flexShrink: 0,
        color: 'text.disabled',
        bgcolor: 'transparent',
        border: '1px dashed',
        borderColor: 'divider',
        '&:hover': { color: 'text.secondary', borderColor: 'text.disabled' },
      }}
    >
      + tag
    </Box>
  );

  return (
    <>
      {chip}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, width: 250, borderRadius: 2.5, mt: 0.5 } } }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            autoFocus
            size="small"
            fullWidth
            placeholder="Tag name"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value.slice(0, MAX_TAG_LENGTH))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }}
            inputProps={{ maxLength: MAX_TAG_LENGTH }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {draftText.length}/{MAX_TAG_LENGTH}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.9} sx={{ mt: 1.25 }}>
          {(Object.keys(TAG_COLORS) as TagColor[]).map((key) => (
            <Box
              key={key}
              component="button"
              type="button"
              aria-label={key}
              onClick={() => setDraftColor(key)}
              sx={{
                width: 20,
                height: 20,
                p: 0,
                border: 'none',
                cursor: 'pointer',
                borderRadius: '50%',
                bgcolor: TAG_COLORS[key],
                outline: draftColor === key ? '2px solid' : 'none',
                outlineColor: 'text.primary',
                outlineOffset: '2px',
              }}
            />
          ))}
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.5 }}>
          {draftText.trim() ? (
            <Box
              sx={{
                px: 1,
                borderRadius: 5,
                fontSize: 11.5,
                fontWeight: 700,
                lineHeight: '18px',
                color: '#fff',
                bgcolor: TAG_COLORS[draftColor],
              }}
            >
              {draftText.trim()}
            </Box>
          ) : null}
          <Box sx={{ flexGrow: 1 }} />
          {current && (
            <Button size="small" color="error" onClick={() => void commit('')} sx={{ minWidth: 0 }}>
              Remove
            </Button>
          )}
          <Button size="small" variant="contained" disableElevation onClick={save}>
            Save
          </Button>
        </Stack>
      </Popover>
    </>
  );
}

/** Redraws only when the device's stored tag changes. */
const DeviceTagChip = memo(DeviceTagChipBase, (prev, next) => prev.tag === next.tag);
export default DeviceTagChip;
