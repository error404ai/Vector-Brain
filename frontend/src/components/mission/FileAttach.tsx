import { useRef } from 'react';
import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { fileBadge, formatSize, MAX_SEND_DEVICES, type DropTarget } from './fileDrop';

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const pop = keyframes`from { opacity: 0; transform: scale(.9); } to { opacity: 1; transform: none; }`;

/** The composer's 📎 chip: opens the file picker. */
export function AttachChip({ onPick, disabled }: { onPick: (file: File) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
      <Chip
        icon={<AttachFileRoundedIcon sx={{ fontSize: 16 }} />}
        label="Attach"
        size="small"
        variant="outlined"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        sx={{ borderColor: 'rgba(47,107,255,.45)', color: 'primary.main', '& .MuiChip-icon': { color: 'primary.main' } }}
      />
    </>
  );
}

/**
 * The file waiting in the composer, with who it will go to and what it costs
 * in bandwidth, so a 100 MB file to 500 phones is never sent by accident.
 */
export function AttachedFile({
  file,
  targets,
  picked,
  onRemove,
}: {
  file: File;
  targets: DropTarget[];
  picked: boolean;
  onRemove: () => void;
}) {
  const badge = fileBadge(file);
  const count = targets.length;
  const tooMany = count > MAX_SEND_DEVICES;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', px: 0.5, pb: 1 }}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          py: 0.5,
          pl: 0.5,
          pr: 0.25,
          borderRadius: '12px',
          bgcolor: 'rgba(47,107,255,.06)',
          border: '1px solid rgba(47,107,255,.25)',
          maxWidth: '100%',
          animation: `${pop} 260ms cubic-bezier(.2,.9,.3,1.3)`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <Box
          sx={{
            flex: 'none',
            width: 30,
            height: 30,
            borderRadius: '8px',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            font: `700 9.5px ${MONO}`,
            background: `linear-gradient(135deg, ${badge.from}, ${badge.to})`,
          }}
        >
          {badge.label}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }} noWrap title={file.name}>
            {file.name}
          </Typography>
          <Typography sx={{ font: `500 11px ${MONO}`, color: 'text.secondary' }}>{formatSize(file.size)}</Typography>
        </Box>
        <Tooltip title="Remove file">
          <IconButton size="small" onClick={onRemove} aria-label="Remove file">
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography sx={{ font: `500 11.5px ${MONO}`, color: tooMany || count === 0 ? 'error.main' : 'text.secondary' }}>
        {count === 0
          ? 'No phone to send to: name one with @ or #, or bring a phone online'
          : tooMany
            ? `${count} phones: one send can reach at most ${MAX_SEND_DEVICES}. Narrow it with @ or #.`
            : `→ ${picked ? '' : 'all online · '}${count} phone${count === 1 ? '' : 's'} · ${formatSize(file.size * count)} total download`}
      </Typography>
    </Box>
  );
}
