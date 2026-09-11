import NetworkCanvas from '@/components/landing/NetworkCanvas';
import PhoneScene from '@/components/landing/PhoneScene';
import ScrollReveal from '@/components/landing/ScrollReveal';
import VectorMark from '@/components/brand/VectorMark';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import BoltIcon from '@mui/icons-material/Bolt';
import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import KeyIcon from '@mui/icons-material/Key';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SendIcon from '@mui/icons-material/Send';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

interface Feature {
  icon: ReactNode;
  title: string;
  body: string;
  /** Wide cards span two columns in the bento grid. */
  wide?: boolean;
}

const FEATURES: Feature[] = [
  {
    icon: <PhoneAndroidIcon />,
    title: 'Your own phone, not a cloud emulator',
    body: 'The agent works through the accessibility service on a handset you own. Apps that block emulators and datacentre IPs behave normally, because nothing about the device is unusual — your accounts are already signed in and your session is the real one.',
    wide: true,
  },
  {
    icon: <KeyIcon />,
    title: 'Your API key, your models',
    body: 'OpenAI, Anthropic, Google, DeepSeek, Groq or OpenRouter. Pay your provider directly, pick a different model per device, and nothing is marked up in between.',
  },
  {
    icon: <BoltIcon />,
    title: 'Record once, replay free',
    body: 'Turn a finished run into a flow. It replays with no model calls at all — no tokens, no thinking time, same result every run.',
  },
  {
    icon: <SendIcon />,
    title: 'Drive it from Telegram',
    body: 'Send /run with the task. The result and a picture of the final screen come back in the same chat, wherever you are.',
  },
  {
    icon: <DevicesOtherIcon />,
    title: 'A fleet, not one handset',
    body: 'Pair as many phones as you like, watch them from one page, broadcast a task to all of them, or take manual control of any screen.',
  },
  {
    icon: <ScheduleIcon />,
    title: 'Scheduled and shareable',
    body: 'Run a task every weekday morning. Share any run as a public link that replays it step by step for someone with no account.',
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Pair a phone', body: 'Install the companion app, turn on accessibility, enter the six-digit code.' },
  { title: 'Add your API key', body: 'Paste a key from any supported provider. That model does the thinking.' },
  { title: 'Say what you want', body: 'Plain language. Watch each step land, from the dashboard or Telegram.' },
];

const HEADING_GRADIENT = 'linear-gradient(180deg, #ffffff 0%, #b9cdf3 100%)';

/**
 * Public landing page at `/`.
 *
 * Self-contained dark styling: the app's MUI theme is light, so every colour
 * here is set explicitly rather than inherited. Nothing on this page depends on
 * being signed in, and no request is made before the visitor acts.
 */
export default function HomePage() {
  return (
    <Box sx={{ bgcolor: '#05070f', color: '#e2e8f0', minHeight: '100vh', overflowX: 'hidden' }}>
      <Helmet>
        <title>Vector Brain — an AI agent that runs your real Android phone</title>
        <meta
          name="description"
          content="Give an AI agent a task in plain language and watch it carry it out on a real Android phone you own. Bring your own API key, run it from Telegram, replay saved flows with no model calls."
        />
      </Helmet>

      {/* ---------------------------------------------------------------- Header */}
      <Box
        component="header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          borderBottom: '1px solid rgba(148,163,184,0.14)',
          bgcolor: 'rgba(5,7,15,0.72)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <Container maxWidth="lg">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 1.5 }}>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 2,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'linear-gradient(150deg, #3b82f6 0%, #1d4ed8 100%)',
                  boxShadow: '0 8px 24px rgba(37,99,235,0.45)',
                }}
              >
                <VectorMark size={22} color="#ffffff" accent="#7dd3fc" />
              </Box>
              <Typography sx={{ fontWeight: 900, color: '#f8fafc', fontSize: 17 }}>Vector Brain</Typography>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Button component={Link} to="/login" sx={{ color: '#cbd5e1', '&:hover': { color: '#ffffff' } }}>
                Sign in
              </Button>
              <Button
                component={Link}
                to="/signup"
                variant="contained"
                sx={{
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  boxShadow: '0 10px 28px rgba(37,99,235,0.4)',
                  '&:hover': { background: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)' },
                }}
              >
                Get started
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* ------------------------------------------------------------------ Hero */}
      <Box sx={{ position: 'relative', overflow: 'hidden' }}>
        <NetworkCanvas />

        {/* Colour wash over the canvas */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background:
              'radial-gradient(900px 500px at 18% 12%, rgba(37,99,235,0.26) 0%, rgba(5,7,15,0) 62%), radial-gradient(760px 460px at 88% 30%, rgba(13,148,136,0.2) 0%, rgba(5,7,15,0) 60%)',
          }}
        />

        <Container maxWidth="lg" sx={{ position: 'relative', py: { xs: 7, md: 12 } }}>
          <Box
            sx={{
              display: 'grid',
              gap: { xs: 5, md: 4 },
              gridTemplateColumns: { xs: '1fr', md: '1.05fr 0.95fr' },
              alignItems: 'center',
            }}
          >
            <ScrollReveal>
              <Stack spacing={3}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    alignSelf: 'flex-start',
                    px: 1.75,
                    py: 0.75,
                    borderRadius: 999,
                    border: '1px solid rgba(96,165,250,0.4)',
                    bgcolor: 'rgba(37,99,235,0.14)',
                  }}
                >
                  <Box
                    sx={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      bgcolor: '#22c55e',
                      boxShadow: '0 0 10px #22c55e',
                    }}
                  />
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#bfdbfe' }}>
                    Free · bring your own API key
                  </Typography>
                </Stack>

                <Typography
                  component="h1"
                  sx={{
                    fontSize: { xs: 40, sm: 54, md: 66 },
                    fontWeight: 900,
                    lineHeight: 1.04,
                    letterSpacing: -1.5,
                    backgroundImage: HEADING_GRADIENT,
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  An AI agent that runs your real Android phone
                </Typography>

                <Typography sx={{ fontSize: { xs: 17, md: 19.5 }, color: 'rgba(203,213,225,0.82)', lineHeight: 1.55, maxWidth: 560 }}>
                  Say what you want in plain language. It reads the screen, taps, types and scrolls on a handset you
                  own — in the apps that refuse to run anywhere else.
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ pt: 1 }}>
                  <Button
                    component={Link}
                    to="/signup"
                    size="large"
                    endIcon={<ArrowForwardIcon />}
                    sx={{
                      px: 4,
                      py: 1.4,
                      fontSize: 16,
                      color: '#ffffff',
                      background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                      boxShadow: '0 16px 40px rgba(37,99,235,0.45)',
                      transition: 'transform 220ms ease, box-shadow 220ms ease',
                      '&:hover': {
                        background: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)',
                        transform: 'translateY(-2px)',
                        boxShadow: '0 22px 52px rgba(37,99,235,0.55)',
                      },
                    }}
                  >
                    Create a free account
                  </Button>
                  <Button
                    component={Link}
                    to="/login"
                    size="large"
                    sx={{
                      px: 4,
                      py: 1.4,
                      fontSize: 16,
                      color: '#e2e8f0',
                      border: '1px solid rgba(148,163,184,0.32)',
                      '&:hover': { borderColor: 'rgba(148,163,184,0.6)', bgcolor: 'rgba(148,163,184,0.08)' },
                    }}
                  >
                    Sign in
                  </Button>
                </Stack>

                <Typography sx={{ fontSize: 14, color: 'rgba(148,163,184,0.78)' }}>
                  One Android phone and a key from a provider you already use.
                </Typography>
              </Stack>
            </ScrollReveal>

            <ScrollReveal delay={120}>
              <PhoneScene />
            </ScrollReveal>
          </Box>
        </Container>
      </Box>

      {/* -------------------------------------------------------------- Features */}
      <Container maxWidth="lg" sx={{ py: { xs: 8, md: 13 } }}>
        <ScrollReveal>
          <Stack spacing={1.5} sx={{ maxWidth: 680, mb: { xs: 5, md: 7 } }}>
            <Typography
              component="h2"
              sx={{
                fontSize: { xs: 30, md: 42 },
                fontWeight: 900,
                lineHeight: 1.15,
                letterSpacing: -1,
                backgroundImage: HEADING_GRADIENT,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Built for phones you actually own
            </Typography>
            <Typography sx={{ fontSize: 17.5, color: 'rgba(148,163,184,0.85)', lineHeight: 1.55 }}>
              Most phone agents drive a virtual device in a datacentre. This one drives yours.
            </Typography>
          </Stack>
        </ScrollReveal>

        <Box
          sx={{
            display: 'grid',
            gap: 2.5,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          }}
        >
          {FEATURES.map((feature, index) => (
            <Box key={feature.title} sx={{ gridColumn: { md: feature.wide ? 'span 2' : 'span 1' } }}>
              <ScrollReveal delay={index * 70}>
                <Box
                  sx={{
                    position: 'relative',
                    height: '100%',
                    p: 3.25,
                    borderRadius: 4,
                    border: '1px solid rgba(148,163,184,0.16)',
                    background: 'linear-gradient(160deg, rgba(30,41,59,0.62) 0%, rgba(10,15,28,0.62) 100%)',
                    backdropFilter: 'blur(8px)',
                    overflow: 'hidden',
                    transition: 'transform 260ms cubic-bezier(0.22,1,0.36,1), border-color 260ms ease, box-shadow 260ms ease',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      borderColor: 'rgba(96,165,250,0.5)',
                      boxShadow: '0 24px 60px rgba(2,6,23,0.6)',
                    },
                    // Light sweeping across the top edge on hover
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 1,
                      background: 'linear-gradient(90deg, transparent, rgba(125,211,252,0.85), transparent)',
                      opacity: 0,
                      transition: 'opacity 260ms ease',
                    },
                    '&:hover::before': { opacity: 1 },
                  }}
                >
                  <Stack spacing={1.75}>
                    <Box
                      sx={{
                        width: 46,
                        height: 46,
                        borderRadius: 3,
                        display: 'grid',
                        placeItems: 'center',
                        color: '#93c5fd',
                        border: '1px solid rgba(96,165,250,0.3)',
                        bgcolor: 'rgba(37,99,235,0.16)',
                      }}
                    >
                      {feature.icon}
                    </Box>
                    <Typography sx={{ fontSize: 19, fontWeight: 800, color: '#f1f5f9', lineHeight: 1.25 }}>
                      {feature.title}
                    </Typography>
                    <Typography sx={{ fontSize: 15, color: 'rgba(148,163,184,0.9)', lineHeight: 1.65 }}>
                      {feature.body}
                    </Typography>
                  </Stack>
                </Box>
              </ScrollReveal>
            </Box>
          ))}
        </Box>
      </Container>

      {/* ----------------------------------------------------------- How it works */}
      <Box sx={{ borderTop: '1px solid rgba(148,163,184,0.14)', borderBottom: '1px solid rgba(148,163,184,0.14)' }}>
        <Container maxWidth="lg" sx={{ py: { xs: 8, md: 13 } }}>
          <ScrollReveal>
            <Typography
              component="h2"
              sx={{
                fontSize: { xs: 30, md: 42 },
                fontWeight: 900,
                lineHeight: 1.15,
                letterSpacing: -1,
                mb: { xs: 5, md: 7 },
                backgroundImage: HEADING_GRADIENT,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Three steps to your first run
            </Typography>
          </ScrollReveal>

          <Box
            sx={{
              display: 'grid',
              gap: { xs: 4, md: 5 },
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            }}
          >
            {STEPS.map((step, index) => (
              <ScrollReveal key={step.title} delay={index * 110}>
                <Stack spacing={2}>
                  <Typography
                    sx={{
                      fontSize: 46,
                      fontWeight: 900,
                      lineHeight: 1,
                      color: 'transparent',
                      WebkitTextStroke: '1.5px rgba(96,165,250,0.55)',
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </Typography>
                  <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>{step.title}</Typography>
                  <Typography sx={{ fontSize: 15.5, color: 'rgba(148,163,184,0.9)', lineHeight: 1.65 }}>
                    {step.body}
                  </Typography>
                </Stack>
              </ScrollReveal>
            ))}
          </Box>
        </Container>
      </Box>

      {/* ------------------------------------------------------------------- CTA */}
      <Container maxWidth="lg" sx={{ py: { xs: 8, md: 13 } }}>
        <ScrollReveal>
          <Box
            sx={{
              position: 'relative',
              overflow: 'hidden',
              p: { xs: 4.5, md: 8 },
              borderRadius: 5,
              textAlign: 'center',
              border: '1px solid rgba(96,165,250,0.28)',
              background:
                'radial-gradient(700px 300px at 50% 0%, rgba(37,99,235,0.32) 0%, rgba(10,15,28,0) 70%), linear-gradient(160deg, rgba(30,41,59,0.7) 0%, rgba(8,12,24,0.7) 100%)',
            }}
          >
            <Stack spacing={3} alignItems="center">
              <Typography
                component="h2"
                sx={{
                  fontSize: { xs: 30, md: 44 },
                  fontWeight: 900,
                  lineHeight: 1.12,
                  letterSpacing: -1,
                  backgroundImage: HEADING_GRADIENT,
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                Put your phone to work
              </Typography>
              <Typography sx={{ fontSize: 17.5, color: 'rgba(148,163,184,0.9)', maxWidth: 540, lineHeight: 1.55 }}>
                Create an account, pair a handset, give it a task. Nothing to pay for here — you only pay your own model
                provider.
              </Typography>
              <Button
                component={Link}
                to="/signup"
                size="large"
                endIcon={<ArrowForwardIcon />}
                sx={{
                  px: 4.5,
                  py: 1.5,
                  fontSize: 16.5,
                  color: '#ffffff',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  boxShadow: '0 18px 44px rgba(37,99,235,0.5)',
                  transition: 'transform 220ms ease, box-shadow 220ms ease',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)',
                    transform: 'translateY(-2px)',
                    boxShadow: '0 24px 58px rgba(37,99,235,0.6)',
                  },
                }}
              >
                Create a free account
              </Button>
            </Stack>
          </Box>
        </ScrollReveal>
      </Container>

      {/* ---------------------------------------------------------------- Footer */}
      <Box component="footer" sx={{ borderTop: '1px solid rgba(148,163,184,0.14)' }}>
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1.25} alignItems="center">
              <VectorMark size={22} color="#60a5fa" accent="#7dd3fc" />
              <Typography sx={{ fontWeight: 800, color: '#e2e8f0' }}>Vector Brain</Typography>
            </Stack>
            <Typography sx={{ fontSize: 13.5, color: 'rgba(148,163,184,0.7)' }}>
              © {new Date().getFullYear()} Vector Brain. All rights reserved.
            </Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
