import FleetWall from '@/components/landing/FleetWall';
import ScrollReveal from '@/components/landing/ScrollReveal';
import VectorMark from '@/components/brand/VectorMark';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CloseIcon from '@mui/icons-material/Close';
import DoneIcon from '@mui/icons-material/Done';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

const LINE = '1px solid rgba(148,163,184,0.16)';
const PANEL = 'linear-gradient(160deg, rgba(23,33,55,0.72) 0%, rgba(8,12,24,0.72) 100%)';

interface ComparisonRow {
  signal: string;
  vector: string;
  scripts: string;
  cloud: string;
  vectorWins: boolean;
}

const COMPARISON: ComparisonRow[] = [
  { signal: 'Writing a test', vector: 'plain English', scripts: 'Appium code', cloud: 'Appium code', vectorWins: true },
  { signal: 'Who has to write it', vector: 'anyone', scripts: 'a QA engineer', cloud: 'a QA engineer', vectorWins: true },
  { signal: 'When the UI changes', vector: 'agent adapts', scripts: 'selector breaks', cloud: 'selector breaks', vectorWins: true },
  { signal: 'Apps that block emulators', vector: 'work normally', scripts: 'depends', cloud: 'blocked', vectorWins: true },
  { signal: 'Your logged-in accounts', vector: 'already there', scripts: 'already there', cloud: 'set up each run', vectorWins: false },
  { signal: 'Repeat runs', vector: 'replay, no model calls', scripts: 'free', cloud: 'billed per minute', vectorWins: false },
  { signal: 'Devices', vector: 'as many as you own', scripts: 'as many as you own', cloud: 'rented per seat', vectorWins: true },
];

const STEPS: { tag: string; title: string; body: string }[] = [
  {
    tag: '01 · PAIR',
    title: 'Pair your phones',
    body: 'Install the companion app on each handset, turn on accessibility, enter the code. Any Android from 10 upwards, however many you have.',
  },
  {
    tag: '02 · CONNECT',
    title: 'Bring your own model',
    body: 'A key from OpenAI, Anthropic, Google, DeepSeek, Groq or OpenRouter. You pay your provider directly, and can run a different model on each device.',
  },
  {
    tag: '03 · INSTRUCT',
    title: 'Say it in plain words',
    body: 'No scripts, no selectors, no SDK. The agent reads the screen, decides what to do, and taps, types and scrolls its way through the task.',
  },
  {
    tag: '04 · SCALE',
    title: 'Send it to the fleet',
    body: 'One instruction goes out to every phone. Watch each one step by step from a single page, or take manual control of any screen.',
  },
  {
    tag: '05 · REPLAY',
    title: 'Save it as a flow',
    body: 'Turn a finished run into a flow and it replays with no model calls at all. Regression runs cost nothing and do the same thing every time.',
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Real phones or emulators?',
    a: 'Phones you already own. The agent works through the Android accessibility service on your own hardware, so nothing about the device looks unusual and the sessions signed into your apps are the real ones.',
  },
  {
    q: 'Do I need to know Appium or write code?',
    a: 'No. That is the point. A test is a sentence describing what should happen. Nobody on the team has to learn a mobile automation framework or maintain selectors when a screen changes.',
  },
  {
    q: 'How many devices can I run?',
    a: 'As many as you pair. There is no per-device seat and no rented hardware — the phones are yours, so the ceiling is whatever you have on the desk.',
  },
  {
    q: 'What does it cost to run?',
    a: 'The platform is free and you bring your own API key, so a run costs whatever your model provider charges for it. Replaying a saved flow calls no model at all, so it costs nothing.',
  },
  {
    q: 'What happens when an app updates and the screen changes?',
    a: 'An AI run reads whatever is actually on screen, so a moved button is not a broken test. A saved flow replays fixed steps, so a changed screen is caught there and can be handed back to the agent.',
  },
  {
    q: 'Can I start a run without opening the dashboard?',
    a: 'Yes. Link a Telegram chat and send the task there. The result and a picture of the final screen come back in the same chat.',
  },
];

/**
 * Public landing page at `/`.
 *
 * The fleet is the pitch, so the fleet is the first thing on the page: one
 * instruction, every phone, each one visibly doing its own work. Everything
 * below it answers the questions an operator asks next, in the order they ask
 * them — why real phones, how it compares to writing Appium, what the steps are.
 */
export default function HomePage() {
  return (
    <Box sx={{ bgcolor: '#05070f', color: '#e2e8f0', minHeight: '100vh', overflowX: 'hidden' }}>
      <Helmet>
        <title>Vector Brain — run one instruction across every Android phone you own</title>
        <meta
          name="description"
          content="Automate real Android phones with plain English instead of Appium scripts. Pair as many devices as you own, run one task across the whole fleet, and replay saved flows with no model calls."
        />
      </Helmet>

      {/* Header */}
      <Box
        component="header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          borderBottom: LINE,
          bgcolor: 'rgba(5,7,15,0.78)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <Container maxWidth="lg">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 1.5 }}>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <VectorMark size={26} color="#60a5fa" accent="#7dd3fc" />
              <Typography sx={{ fontWeight: 800, fontSize: 16.5, color: '#f8fafc' }}>Vector Brain</Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button component={Link} to="/login" sx={{ color: '#cbd5e1', '&:hover': { color: '#fff' } }}>
                Sign in
              </Button>
              <Button
                component={Link}
                to="/signup"
                variant="contained"
                disableElevation
                sx={{ bgcolor: '#2563eb', '&:hover': { bgcolor: '#1d4ed8' } }}
              >
                Get started free
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* Hero */}
      <Container maxWidth="lg" sx={{ pt: { xs: 5, md: 8 }, pb: { xs: 6, md: 9 } }}>
        <Stack spacing={2.5} sx={{ maxWidth: 780, mb: { xs: 4, md: 6 } }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.6, color: '#7dd3fc' }}>
            ONE INSTRUCTION · EVERY PHONE
          </Typography>
          <Typography
            component="h1"
            sx={{ fontSize: { xs: 38, sm: 50, md: 60 }, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.6, color: '#f8fafc' }}
          >
            Automate unlimited Android phones with plain English
          </Typography>
          <Typography sx={{ fontSize: { xs: 17, md: 19 }, color: 'rgba(203,213,225,0.82)', lineHeight: 1.55, maxWidth: 620 }}>
            Say what you want done. An AI agent reads the screen and carries it out on real phones you own — one of
            them, or every one of them at once. No Appium, no selectors, no QA engineer.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ pt: 0.5 }}>
            <Button
              component={Link}
              to="/signup"
              size="large"
              endIcon={<ArrowForwardIcon />}
              sx={{ px: 4, py: 1.35, fontSize: 16, color: '#fff', bgcolor: '#2563eb', '&:hover': { bgcolor: '#1d4ed8' } }}
            >
              Start free
            </Button>
            <Button
              component={Link}
              to="/login"
              size="large"
              sx={{
                px: 4,
                py: 1.35,
                fontSize: 16,
                color: '#e2e8f0',
                border: '1px solid rgba(148,163,184,0.3)',
                '&:hover': { borderColor: 'rgba(148,163,184,0.6)', bgcolor: 'rgba(148,163,184,0.08)' },
              }}
            >
              Sign in
            </Button>
          </Stack>
        </Stack>

        {/* Fleet wall */}
        <ScrollReveal>
          <Box sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 3, border: LINE, background: PANEL }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              flexWrap="wrap"
              useFlexGap
              spacing={1}
              sx={{ mb: 1.75, px: 0.5 }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#22c55e', boxShadow: '0 0 10px #22c55e' }} />
                <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: '#e2e8f0' }}>
                  1 instruction → 24 devices
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 12.5, color: 'rgba(148,163,184,0.85)' }}>
                “Open the app, sign in, and check the home feed loads”
              </Typography>
            </Stack>
            <FleetWall count={24} />
          </Box>
        </ScrollReveal>
      </Container>

      {/* Comparison */}
      <Box sx={{ borderTop: LINE, borderBottom: LINE }}>
        <Container maxWidth="lg" sx={{ py: { xs: 7, md: 10 } }}>
          <ScrollReveal>
            <Stack spacing={1.5} sx={{ maxWidth: 700, mb: { xs: 3.5, md: 5 } }}>
              <Typography sx={{ fontSize: { xs: 28, md: 38 }, fontWeight: 800, letterSpacing: -1, color: '#f8fafc', lineHeight: 1.15 }}>
                Not scripts. Not rented emulators.
              </Typography>
              <Typography sx={{ fontSize: 17, color: 'rgba(148,163,184,0.9)', lineHeight: 1.6 }}>
                Mobile test automation normally costs you an engineer to write it and a cloud bill to run it. This
                removes the first and makes the second your own hardware.
              </Typography>
            </Stack>
          </ScrollReveal>

          <ScrollReveal>
            <Box sx={{ borderRadius: 3, border: LINE, overflow: 'hidden', background: PANEL }}>
              <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 640 }}>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '1.3fr 1fr 1fr 1fr',
                      px: 2,
                      py: 1.5,
                      borderBottom: LINE,
                    }}
                  >
                    {['', 'Vector Brain', 'Appium scripts', 'Cloud device farm'].map((head, index) => (
                      <Typography
                        key={head || 'blank'}
                        sx={{
                          fontSize: 12.5,
                          fontWeight: 800,
                          letterSpacing: 0.6,
                          color: index === 1 ? '#7dd3fc' : 'rgba(148,163,184,0.8)',
                        }}
                      >
                        {head.toUpperCase()}
                      </Typography>
                    ))}
                  </Box>

                  {COMPARISON.map((row) => (
                    <Box
                      key={row.signal}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: '1.3fr 1fr 1fr 1fr',
                        alignItems: 'center',
                        px: 2,
                        py: 1.5,
                        borderBottom: LINE,
                        '&:last-of-type': { borderBottom: 'none' },
                      }}
                    >
                      <Typography sx={{ fontSize: 14, color: '#e2e8f0' }}>{row.signal}</Typography>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        {row.vectorWins && <DoneIcon sx={{ fontSize: 15, color: '#22c55e' }} />}
                        <Typography sx={{ fontSize: 13.5, color: '#bfdbfe' }}>{row.vector}</Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        {row.vectorWins && <CloseIcon sx={{ fontSize: 15, color: 'rgba(148,163,184,0.55)' }} />}
                        <Typography sx={{ fontSize: 13.5, color: 'rgba(148,163,184,0.85)' }}>{row.scripts}</Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        {row.vectorWins && <CloseIcon sx={{ fontSize: 15, color: 'rgba(148,163,184,0.55)' }} />}
                        <Typography sx={{ fontSize: 13.5, color: 'rgba(148,163,184,0.85)' }}>{row.cloud}</Typography>
                      </Stack>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          </ScrollReveal>
        </Container>
      </Box>

      {/* How it works */}
      <Container maxWidth="lg" sx={{ py: { xs: 7, md: 10 } }}>
        <ScrollReveal>
          <Typography
            sx={{ fontSize: { xs: 28, md: 38 }, fontWeight: 800, letterSpacing: -1, color: '#f8fafc', mb: { xs: 4, md: 6 } }}
          >
            How it works
          </Typography>
        </ScrollReveal>

        <Box
          sx={{
            display: 'grid',
            gap: 2.5,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          }}
        >
          {STEPS.map((step, index) => (
            <ScrollReveal key={step.tag} delay={index * 70}>
              <Box sx={{ height: '100%', p: 3, borderRadius: 3, border: LINE, background: PANEL }}>
                <Stack spacing={1.5}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 1.2, color: '#60a5fa' }}>
                    {step.tag}
                  </Typography>
                  <Typography sx={{ fontSize: 19, fontWeight: 800, color: '#f1f5f9' }}>{step.title}</Typography>
                  <Typography sx={{ fontSize: 14.5, color: 'rgba(148,163,184,0.9)', lineHeight: 1.65 }}>
                    {step.body}
                  </Typography>
                </Stack>
              </Box>
            </ScrollReveal>
          ))}
        </Box>
      </Container>

      {/* FAQ */}
      <Box sx={{ borderTop: LINE }}>
        <Container maxWidth="md" sx={{ py: { xs: 7, md: 10 } }}>
          <ScrollReveal>
            <Typography
              sx={{ fontSize: { xs: 28, md: 38 }, fontWeight: 800, letterSpacing: -1, color: '#f8fafc', mb: { xs: 3, md: 4.5 } }}
            >
              Questions operators ask
            </Typography>
          </ScrollReveal>

          {FAQ.map((item) => (
            <Accordion
              key={item.q}
              disableGutters
              elevation={0}
              square
              sx={{
                bgcolor: 'transparent',
                borderBottom: LINE,
                '&::before': { display: 'none' },
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: 'rgba(148,163,184,0.8)' }} />} sx={{ px: 0 }}>
                <Typography sx={{ fontSize: 16.5, fontWeight: 700, color: '#e2e8f0' }}>{item.q}</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 0, pb: 2.5 }}>
                <Typography sx={{ fontSize: 15.5, color: 'rgba(148,163,184,0.92)', lineHeight: 1.7 }}>
                  {item.a}
                </Typography>
              </AccordionDetails>
            </Accordion>
          ))}
        </Container>
      </Box>

      {/* CTA */}
      <Box sx={{ borderTop: LINE }}>
        <Container maxWidth="lg" sx={{ py: { xs: 8, md: 11 } }}>
          <ScrollReveal>
            <Stack spacing={2.5} alignItems="center" sx={{ textAlign: 'center' }}>
              <Typography
                sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 800, letterSpacing: -1.2, color: '#f8fafc', lineHeight: 1.12 }}
              >
                Put the whole fleet to work
              </Typography>
              <Typography sx={{ fontSize: 17, color: 'rgba(148,163,184,0.9)', maxWidth: 540, lineHeight: 1.6 }}>
                Pair a phone, add your API key, type what you want done. The platform is free — you only pay your own
                model provider.
              </Typography>
              <Button
                component={Link}
                to="/signup"
                size="large"
                endIcon={<ArrowForwardIcon />}
                sx={{ px: 4.5, py: 1.5, fontSize: 16.5, color: '#fff', bgcolor: '#2563eb', '&:hover': { bgcolor: '#1d4ed8' } }}
              >
                Start free
              </Button>
            </Stack>
          </ScrollReveal>
        </Container>
      </Box>

      {/* Footer */}
      <Box component="footer" sx={{ borderTop: LINE }}>
        <Container maxWidth="lg" sx={{ py: 3.5 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <VectorMark size={20} color="#60a5fa" accent="#7dd3fc" />
              <Typography sx={{ fontWeight: 700, fontSize: 14.5, color: 'rgba(226,232,240,0.85)' }}>
                Vector Brain
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: 13, color: 'rgba(148,163,184,0.7)' }}>
              © {new Date().getFullYear()} Vector Brain. All rights reserved.
            </Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
