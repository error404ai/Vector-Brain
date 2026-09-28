import { useState } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import type { TaskAnswer } from '@/RTKService/commandChatService/commandChatService';

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const INK = '#0E1630';
const MUTED = '#5D6785';
const LINE = '#E2E7F3';

const rise = keyframes`from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; }`;
const sheen = keyframes`from { background-position: 160% 0; } to { background-position: -60% 0; }`;
const reduced = { '@media (prefers-reduced-motion: reduce)': { '&, & *, &::after': { animation: 'none !important' } } };

const chip = {
  font: `700 13px ${MONO}`,
  bgcolor: '#EEF3FF',
  color: '#1D4ED8',
  px: 1,
  py: 0.25,
  borderRadius: '7px',
  whiteSpace: 'nowrap' as const,
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

function Button({ onClick, primary, children }: { onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        font: '700 12.5px inherit',
        px: 1.5,
        py: 0.9,
        borderRadius: '10px',
        border: `1px solid ${primary ? INK : LINE}`,
        bgcolor: primary ? INK : '#fff',
        color: primary ? '#fff' : INK,
        transition: 'transform 150ms, box-shadow 150ms',
        '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 8px 18px -10px rgba(47,107,255,.6)' },
        '&:focus-visible': { outline: '2px solid #2F6BFF', outlineOffset: 2 },
      }}
    >
      {children}
    </ButtonBase>
  );
}

/**
 * The answer to what the user asked, posted once a task from the chat has
 * finished: the question, a one-line answer, one row per phone with its key
 * fact as a chip, and Retry for the phones that failed.
 */
export default function AnswerCard({ result, onRetryFailed }: { result: TaskAnswer; onRetryFailed?: (missionId: number) => void }) {
  const [copied, setCopied] = useState(false);
  const failed = result.phones.filter((p) => !p.ok);

  const copy = async () => {
    const lines = [result.answer, '', ...result.phones.map((p) => `${p.name}: ${p.ok ? p.value || p.detail : `failed — ${p.detail}`}`)];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard refused (insecure origin): nothing to do.
    }
  };

  return (
    <Box
      sx={{
        width: '100%',
        bgcolor: '#fff',
        borderRadius: '22px',
        border: '1px solid #fff',
        boxShadow: '0 26px 60px -34px rgba(47,70,160,.5)',
        overflow: 'hidden',
        color: INK,
        animation: `${rise} 480ms cubic-bezier(.2,.8,.2,1)`,
        ...reduced,
      }}
    >
      <Box
        sx={{
          px: 2.25,
          py: 1.75,
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(120deg, #EEF3FF, #F6F0FF 55%, #EFFBF6)',
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(100deg, transparent 35%, rgba(255,255,255,.75) 50%, transparent 65%)',
            backgroundSize: '250% 100%',
            animation: `${sheen} 1.4s ease .3s 1 both`,
            pointerEvents: 'none',
          },
        }}
      >
        <Typography sx={{ font: `700 10.5px ${MONO}`, letterSpacing: '.14em', color: '#7C5CFF' }}>ANSWER</Typography>
        <Typography sx={{ fontWeight: 800, fontSize: 19, lineHeight: 1.25, letterSpacing: '-0.02em', mt: 0.25 }}>{result.question}</Typography>
      </Box>

      <Box sx={{ px: 2.25, py: 1.75, display: 'grid', gap: 1.5 }}>
        <Typography sx={{ fontSize: 15.5, lineHeight: 1.55 }}>{result.answer}</Typography>
        <Box sx={{ display: 'grid', gap: 1 }}>
          {result.phones.map((p, i) => (
            <Box
              key={`${p.name}-${i}`}
              sx={{
                display: 'grid',
                gridTemplateColumns: '34px minmax(0, 1fr) auto',
                gap: 1.5,
                alignItems: 'center',
                px: 1.5,
                py: 1.25,
                border: `1px solid ${p.ok ? LINE : '#FFD5DC'}`,
                bgcolor: p.ok ? '#fff' : '#FFF8F9',
                borderRadius: '14px',
                animation: `${rise} 420ms cubic-bezier(.2,.8,.2,1) ${150 + i * 90}ms both`,
              }}
            >
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: '11px',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 16,
                  bgcolor: p.ok ? 'rgba(18,199,154,.13)' : 'rgba(240,68,90,.1)',
                }}
              >
                {p.ok ? '📱' : '⚠️'}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 700, fontSize: 14 }}>
                  {p.name}
                </Typography>
                {p.detail && <Typography sx={{ fontSize: 12.5, color: MUTED, lineHeight: 1.4 }}>{p.detail}</Typography>}
              </Box>
              {p.ok ? (
                p.value ? (
                  <Box component="span" title={p.value} sx={chip}>
                    {p.value}
                  </Box>
                ) : (
                  <Box component="span" sx={{ fontWeight: 700, fontSize: 12.5, color: '#0B9A77' }}>
                    ✓ Done
                  </Box>
                )
              ) : (
                <Box component="span" sx={{ fontWeight: 700, fontSize: 12.5, color: '#E0344F', whiteSpace: 'nowrap' }}>
                  No answer
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end', px: 2.25, pb: 1.75 }}>
        <Button onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy answer'}</Button>
        {failed.length > 0 && onRetryFailed && (
          <Button primary onClick={() => onRetryFailed(result.mission_id)}>
            {failed.length === 1 ? `Retry ${failed[0].name.split(' ')[0]}` : `Retry ${failed.length} failed`}
          </Button>
        )}
      </Box>
    </Box>
  );
}
