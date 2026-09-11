import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { Box, Chip, Stack, Typography } from '@mui/material';

interface Step {
  index: number;
  tool: string;
  thought: string;
  result: string;
}

const STEPS: Step[] = [
  {
    index: 1,
    tool: 'open_url',
    thought: 'Two things to do. Start by opening google.com.',
    result: 'Opened https://www.google.com',
  },
  {
    index: 2,
    tool: 'open_url',
    thought: 'Google is loaded. Now open x.com.',
    result: 'Opened https://x.com',
  },
];

const BORDER = '1px solid #e5e7eb';

/**
 * The run card from the Android Agent page, rebuilt for the landing page.
 *
 * Real markup rather than a screenshot: it stays sharp at any zoom, reflows on
 * a phone, and the text is selectable and readable to search engines. The run
 * shown is one that actually happened, down to the step count and duration.
 */
export default function RunPreview() {
  return (
    <Box
      sx={{
        border: BORDER,
        borderRadius: 2,
        bgcolor: '#ffffff',
        overflow: 'hidden',
        boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
      }}
    >
      {/* Window chrome, so it reads as a screen rather than a diagram */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 1.25, borderBottom: BORDER, bgcolor: '#f9fafb' }}
      >
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#e5e7eb' }} />
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#e5e7eb' }} />
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#e5e7eb' }} />
        <Typography sx={{ ml: 1, fontSize: 12.5, color: 'text.secondary' }}>Google sdk_gphone</Typography>
      </Stack>

      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        {/* What the person typed */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderRadius: 2,
              bgcolor: 'primary.main',
              color: '#ffffff',
              maxWidth: '85%',
            }}
          >
            <Typography sx={{ fontSize: 14.5 }}>open google.com and visit x.com</Typography>
          </Box>
        </Box>

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.75 }}>
          <Typography sx={{ fontSize: 14.5, fontWeight: 800 }}>Android Autonomous Agent</Typography>
          <Chip
            icon={<CheckCircleIcon sx={{ fontSize: 16 }} />}
            label="Completed"
            size="small"
            color="success"
            variant="outlined"
            sx={{ fontWeight: 700 }}
          />
        </Stack>

        {/* Step timeline */}
        <Stack spacing={2} sx={{ pl: 0.5, borderLeft: '2px solid #e5e7eb', ml: 0.5 }}>
          {STEPS.map((step) => (
            <Box key={step.index} sx={{ pl: 2, position: 'relative' }}>
              <Box
                sx={{
                  position: 'absolute',
                  left: -6,
                  top: 5,
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  bgcolor: 'success.main',
                }}
              />
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }} flexWrap="wrap" useFlexGap>
                <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: 'text.secondary', letterSpacing: 0.6 }}>
                  STEP {step.index}
                </Typography>
                <Box
                  component="code"
                  sx={{
                    px: 0.75,
                    py: 0.25,
                    borderRadius: 1,
                    fontSize: 12,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    bgcolor: '#eff6ff',
                    color: '#1d4ed8',
                  }}
                >
                  {step.tool}
                </Box>
              </Stack>
              <Typography sx={{ fontSize: 14, color: 'text.primary', lineHeight: 1.5 }}>{step.thought}</Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
                Action succeeded: {step.result}
              </Typography>
            </Box>
          ))}
        </Stack>

        {/* Result */}
        <Box sx={{ mt: 2.5, p: 2, borderRadius: 2, border: '1px solid #d1fae5', bgcolor: '#f0fdf4' }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: '#047857', letterSpacing: 0.6, mb: 0.75 }}>
            RESULT
          </Typography>
          <Typography sx={{ fontSize: 14, lineHeight: 1.6 }}>
            Both pages are open in Chrome, with x.com in the active tab.
          </Typography>
        </Box>

        <Typography sx={{ mt: 1.5, fontSize: 12.5, color: 'text.secondary' }}>2 steps · 18s · done</Typography>
      </Box>
    </Box>
  );
}
