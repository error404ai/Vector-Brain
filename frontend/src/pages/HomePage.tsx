import Logo from '@/components/ui/Logo';
import BoltIcon from '@mui/icons-material/Bolt';
import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import KeyIcon from '@mui/icons-material/Key';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SendIcon from '@mui/icons-material/Send';
import { alpha, Box, Button, Chip, Container, Divider, Paper, Stack, Typography, useTheme } from '@mui/material';
import type { ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

interface Feature {
  icon: ReactNode;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: <PhoneAndroidIcon />,
    title: 'Your own phone, not a cloud emulator',
    body: 'The agent runs on a handset you own, through the accessibility service. Apps that block emulators and datacentre IPs behave normally, because nothing about the device is unusual.',
  },
  {
    icon: <KeyIcon />,
    title: 'Your API key, your models',
    body: 'Bring a key from OpenAI, Anthropic, Google, DeepSeek, Groq or OpenRouter. You pay your provider directly, pick a different model per device, and nothing is marked up in between.',
  },
  {
    icon: <BoltIcon />,
    title: 'Record once, replay for free',
    body: 'Turn a finished run into a flow and it replays the same steps with no model calls at all — no tokens, no waiting for a model to think, and the same result every time.',
  },
  {
    icon: <SendIcon />,
    title: 'Run it from Telegram',
    body: 'Link a chat and send /run with what you want done. You get the result and a picture of the final screen back in the same chat, wherever you are.',
  },
  {
    icon: <DevicesOtherIcon />,
    title: 'A fleet, not one handset',
    body: 'Pair as many phones as you like, watch them from one page, send the same task to all of them, or take manual control of any screen.',
  },
  {
    icon: <ScheduleIcon />,
    title: 'Scheduled and shareable',
    body: 'Run a task every weekday morning, and share any run as a public link that replays it step by step for someone who has no account.',
  },
];

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Pair a phone',
    body: 'Install the companion app, turn on accessibility, and enter the six-digit code the dashboard shows you.',
  },
  {
    title: 'Add your API key',
    body: 'Paste a key from any supported provider in Settings. The agent uses that model to decide what to do.',
  },
  {
    title: 'Type what you want done',
    body: 'Plain language, e.g. “open YouTube and play lofi study music”. Watch it work step by step, from the dashboard or Telegram.',
  },
];

/**
 * Public landing page at `/`.
 *
 * This route used to render the login form, so every link shared anywhere led
 * straight to a password box with no explanation of what the product was.
 */
export default function HomePage() {
  const theme = useTheme();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Helmet>
        <title>Vector Brain — an AI agent that runs on your real Android phone</title>
        <meta
          name="description"
          content="Vector Brain gives an AI agent control of a real Android phone you own. Bring your own API key, run tasks from the dashboard or Telegram, and replay saved flows with no model calls."
        />
      </Helmet>

      {/* Header */}
      <Box
        component="header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: alpha('#ffffff', 0.85),
          backdropFilter: 'blur(8px)',
        }}
      >
        <Container maxWidth="lg">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 1.5 }}>
            <Logo size={36} showText />
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Button component={Link} to="/login" color="inherit">
                Sign in
              </Button>
              <Button component={Link} to="/signup" variant="contained">
                Get started
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* Hero */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #f8fbff 0%, #e5f6ff 48%, #f8fbff 100%)',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="lg" sx={{ py: { xs: 7, md: 11 } }}>
          <Stack spacing={3} sx={{ maxWidth: 760 }}>
            <Chip
              label="Free · bring your own API key"
              color="primary"
              variant="outlined"
              sx={{ alignSelf: 'flex-start', fontWeight: 700 }}
            />
            <Typography
              component="h1"
              sx={{ fontSize: { xs: 34, sm: 46, md: 56 }, fontWeight: 900, lineHeight: 1.1, letterSpacing: -0.5 }}
            >
              An AI agent that uses your real Android phone
            </Typography>
            <Typography sx={{ fontSize: { xs: 17, md: 20 }, color: 'text.secondary', lineHeight: 1.5 }}>
              Tell it what to do in plain language. It reads the screen, taps, types and scrolls on a phone you own —
              with your accounts already signed in, in apps that refuse to run anywhere else.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ pt: 1 }}>
              <Button component={Link} to="/signup" variant="contained" size="large" sx={{ px: 4, py: 1.25 }}>
                Create a free account
              </Button>
              <Button component={Link} to="/login" variant="outlined" size="large" sx={{ px: 4, py: 1.25 }}>
                Sign in
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              You need one Android phone and an API key from a provider you already use.
            </Typography>
          </Stack>
        </Container>
      </Box>

      {/* Features */}
      <Container maxWidth="lg" sx={{ py: { xs: 7, md: 10 } }}>
        <Stack spacing={1} sx={{ maxWidth: 680, mb: { xs: 4, md: 6 } }}>
          <Typography component="h2" sx={{ fontSize: { xs: 26, md: 34 }, fontWeight: 800, lineHeight: 1.2 }}>
            Built for phones you actually own
          </Typography>
          <Typography sx={{ fontSize: 17, color: 'text.secondary', lineHeight: 1.5 }}>
            Most phone agents drive a virtual device in a datacentre. This one drives yours.
          </Typography>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gap: 2.5,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          }}
        >
          {FEATURES.map((feature) => (
            <Paper
              key={feature.title}
              sx={{
                p: 3,
                borderRadius: 3,
                height: '100%',
                transition: 'border-color 220ms ease, box-shadow 220ms ease, transform 220ms ease',
                '&:hover': {
                  borderColor: alpha(theme.palette.primary.main, 0.35),
                  boxShadow: `0 10px 30px ${alpha(theme.palette.primary.main, 0.08)}`,
                  transform: 'translateY(-2px)',
                },
              }}
            >
              <Stack spacing={1.5}>
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
                  {feature.icon}
                </Box>
                <Typography variant="h6" sx={{ fontSize: 18 }}>
                  {feature.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                  {feature.body}
                </Typography>
              </Stack>
            </Paper>
          ))}
        </Box>
      </Container>

      {/* How it works */}
      <Box sx={{ bgcolor: '#ffffff', borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Container maxWidth="lg" sx={{ py: { xs: 7, md: 10 } }}>
          <Typography
            component="h2"
            sx={{ fontSize: { xs: 26, md: 34 }, fontWeight: 800, lineHeight: 1.2, mb: { xs: 4, md: 6 } }}
          >
            Three steps to your first run
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gap: { xs: 3, md: 4 },
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            }}
          >
            {STEPS.map((step, index) => (
              <Stack key={step.title} spacing={1.5}>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'primary.main',
                    color: '#ffffff',
                    fontWeight: 800,
                  }}
                >
                  {index + 1}
                </Box>
                <Typography variant="h6" sx={{ fontSize: 18 }}>
                  {step.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                  {step.body}
                </Typography>
              </Stack>
            ))}
          </Box>
        </Container>
      </Box>

      {/* Closing call to action */}
      <Container maxWidth="lg" sx={{ py: { xs: 7, md: 10 } }}>
        <Paper
          sx={{
            p: { xs: 4, md: 6 },
            borderRadius: 4,
            textAlign: 'center',
            background: 'linear-gradient(135deg, #f8fbff 0%, #e5f6ff 100%)',
          }}
        >
          <Stack spacing={2.5} alignItems="center">
            <Typography component="h2" sx={{ fontSize: { xs: 26, md: 34 }, fontWeight: 800, lineHeight: 1.2 }}>
              Put your phone to work
            </Typography>
            <Typography sx={{ fontSize: 17, color: 'text.secondary', maxWidth: 520, lineHeight: 1.5 }}>
              Create an account, pair a handset and give it a task. There is nothing to pay for here — you only pay your
              own model provider.
            </Typography>
            <Button component={Link} to="/signup" variant="contained" size="large" sx={{ px: 4, py: 1.25 }}>
              Create a free account
            </Button>
          </Stack>
        </Paper>
      </Container>

      {/* Footer */}
      <Box component="footer" sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: '#ffffff' }}>
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
          >
            <Logo size={30} showText />
            <Stack direction="row" spacing={2} alignItems="center" divider={<Divider orientation="vertical" flexItem />}>
              <Button component={Link} to="/login" size="small" color="inherit">
                Sign in
              </Button>
              <Button component={Link} to="/signup" size="small" color="inherit">
                Sign up
              </Button>
            </Stack>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2.5 }}>
            © {new Date().getFullYear()} Vector Brain. All rights reserved.
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}
