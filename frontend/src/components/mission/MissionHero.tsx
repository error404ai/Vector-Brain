import { Box, ButtonBase, keyframes, Typography } from '@mui/material';
import VectorBot from './VectorBot';
import type { BotMood } from './vectorBotScene';

/** Starters: the label on the chip and the text it puts in the composer. */
const STARTERS: [string, string][] = [
  ['Check fleet status', 'How many phones are online and ready?'],
  ['Install an app everywhere', 'On all ready phones, open Play Store, install '],
  ['Show live screens', 'Show me every phone screen right now'],
  ['Who are you?', 'Who are you and what can you do?'],
];

const rise = keyframes`from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}`;

/**
 * The first screen of Mission Control: Vector greets you, and a few starters
 * fill the composer (they do not send, so the text can be edited first).
 */
export default function MissionHero({ mood, onPick }: { mood: BotMood; onPick: (text: string) => void }) {
  return (
    <Box
      sx={{
        minHeight: { xs: '52vh', md: '58vh' },
        display: 'grid',
        justifyItems: 'center',
        alignContent: 'center',
        gap: 1.5,
        textAlign: 'center',
        px: 2,
        '@media (prefers-reduced-motion: reduce)': { '& *': { animation: 'none !important' } },
      }}
    >
      <VectorBot mood={mood} size="min(300px, 70vw)" />
      <Typography
        component="h2"
        sx={{
          fontWeight: 800,
          fontSize: { xs: 26, md: 36 },
          lineHeight: 1.12,
          letterSpacing: '-0.02em',
          textWrap: 'balance',
          animation: `${rise} 500ms cubic-bezier(.2,.8,.2,1) 150ms both`,
        }}
      >
        Hi, I&apos;m{' '}
        <Box component="span" sx={{ color: 'primary.main' }}>
          Vector
        </Box>
        . What should your phones do?
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1, maxWidth: 720 }}>
        {STARTERS.map(([label, text], i) => (
          <ButtonBase
            key={label}
            onClick={() => onPick(text)}
            sx={{
              px: 2,
              py: 1.1,
              borderRadius: 999,
              border: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              fontSize: 14,
              fontWeight: 500,
              color: 'text.primary',
              transition: 'transform 160ms, border-color 160ms, color 160ms',
              animation: `${rise} 450ms cubic-bezier(.2,.8,.2,1) ${300 + i * 80}ms both`,
              '&:hover': { borderColor: 'primary.main', color: 'primary.main', transform: 'translateY(-2px)' },
              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            }}
          >
            {label}
          </ButtonBase>
        ))}
      </Box>
    </Box>
  );
}
