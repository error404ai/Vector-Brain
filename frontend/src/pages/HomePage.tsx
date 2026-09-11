import RunPreview from '@/components/landing/RunPreview';
import ScrollReveal from '@/components/landing/ScrollReveal';
import VectorMark from '@/components/brand/VectorMark';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

const BORDER = '1px solid #e5e7eb';

interface Feature {
  title: string;
  body: string;
  /** The small piece of real interface that sits under the copy. */
  visual: 'devices' | 'flow' | 'telegram';
}

const FEATURES: Feature[] = [
  {
    title: 'Every phone you own, in one place',
    body: 'Pair as many handsets as you like. Send a task to one, or the same task to all of them, and take manual control of any screen when you want to drive it yourself.',
    visual: 'devices',
  },
  {
    title: 'Record once, then replay for free',
    body: 'Save a finished run as a flow. Replaying it calls no model at all — no tokens spent, no waiting for a model to think, and the same steps every time.',
    visual: 'flow',
  },
  {
    title: 'Start a run from Telegram',
    body: 'Link a chat and send the task. The result and a picture of the final screen come back in the same chat, so you can start something while you are away from your desk.',
    visual: 'telegram',
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Pair a phone', body: 'Install the companion app, turn on accessibility, enter the six-digit code.' },
  { title: 'Add your API key', body: 'OpenAI, Anthropic, Google, DeepSeek, Groq or OpenRouter. That model does the thinking.' },
  { title: 'Say what you want', body: 'Plain language. Every step shows up as it happens, with what the agent was thinking.' },
];

/** Small, honest pieces of interface used beside the feature copy. */
function FeatureVisual({ kind }: { kind: Feature['visual'] }) {
  if (kind === 'devices') {
    return (
      <Stack spacing={0} sx={{ border: BORDER, borderRadius: 2, overflow: 'hidden', bgcolor: '#ffffff' }}>
        {[
          { name: 'Google sdk_gphone', meta: 'Android 17 · API 37', online: true },
          { name: 'Xiaomi M2006C3LI', meta: 'Android 10 · API 29', online: false },
          { name: 'realme 1911', meta: 'Android 10 · API 29', online: false },
        ].map((device, index) => (
          <Stack
            key={device.name}
            direction="row"
            alignItems="center"
            spacing={1.5}
            sx={{ px: 2, py: 1.5, borderTop: index === 0 ? 'none' : BORDER }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                bgcolor: device.online ? 'success.main' : '#d1d5db',
              }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700 }} noWrap>
                {device.name}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }} noWrap>
                {device.meta}
              </Typography>
            </Box>
          </Stack>
        ))}
      </Stack>
    );
  }

  if (kind === 'flow') {
    return (
      <Box sx={{ border: BORDER, borderRadius: 2, bgcolor: '#ffffff', p: 2 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 1.5 }}>Morning check · saved flow</Typography>
        <Stack spacing={1}>
          {['open_app', 'tap_coordinate', 'scroll_element', 'read_ui_tree'].map((tool) => (
            <Stack key={tool} direction="row" alignItems="center" spacing={1.25}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main' }} />
              <Typography
                sx={{ fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'text.secondary' }}
              >
                {tool}
              </Typography>
            </Stack>
          ))}
        </Stack>
        <Typography sx={{ mt: 1.75, fontSize: 12.5, color: 'text.secondary' }}>
          7 steps · 20.9s · 0 model calls
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={1.25} sx={{ border: BORDER, borderRadius: 2, bgcolor: '#ffffff', p: 2 }}>
      <Box sx={{ alignSelf: 'flex-end', maxWidth: '90%', px: 1.75, py: 1, borderRadius: 2, bgcolor: '#dcfce7' }}>
        <Typography sx={{ fontSize: 13.5 }}>/run open google.com and visit x.com</Typography>
      </Box>
      <Box sx={{ alignSelf: 'flex-start', maxWidth: '90%', px: 1.75, py: 1, borderRadius: 2, bgcolor: '#f3f4f6' }}>
        <Typography sx={{ fontSize: 13.5 }}>Started on Google sdk_gphone. I’ll send the result here.</Typography>
      </Box>
      <Box sx={{ alignSelf: 'flex-start', maxWidth: '90%', px: 1.75, py: 1, borderRadius: 2, bgcolor: '#f3f4f6' }}>
        <Typography sx={{ fontSize: 13.5 }}>Done on Google sdk_gphone · 2 steps · 18s</Typography>
      </Box>
    </Stack>
  );
}

/**
 * Public landing page at `/`.
 *
 * Product first: the largest thing on the page is the interface itself, showing
 * a run that actually happened. No decorative background, no gradient text — the
 * screens carry the page, and everything else stays out of their way.
 */
export default function HomePage() {
  return (
    <Box sx={{ bgcolor: '#ffffff', minHeight: '100vh' }}>
      <Helmet>
        <title>Vector Brain — an AI agent that runs your real Android phone</title>
        <meta
          name="description"
          content="Give an AI agent a task in plain language and watch it carry it out on a real Android phone you own. Bring your own API key, start runs from Telegram, replay saved flows with no model calls."
        />
      </Helmet>

      {/* Header */}
      <Box component="header" sx={{ borderBottom: BORDER, position: 'sticky', top: 0, zIndex: 10, bgcolor: '#ffffff' }}>
        <Container maxWidth="lg">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 1.5 }}>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <VectorMark size={26} color="#2563eb" accent="#60a5fa" />
              <Typography sx={{ fontWeight: 800, fontSize: 16.5 }}>Vector Brain</Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button component={Link} to="/login" color="inherit">
                Sign in
              </Button>
              <Button component={Link} to="/signup" variant="contained" disableElevation>
                Get started
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* Hero */}
      <Container maxWidth="lg" sx={{ pt: { xs: 6, md: 9 }, pb: { xs: 6, md: 10 } }}>
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 5, md: 7 },
            gridTemplateColumns: { xs: '1fr', md: '0.85fr 1.15fr' },
            alignItems: 'center',
          }}
        >
          <Stack spacing={2.5}>
            <Typography
              component="h1"
              sx={{ fontSize: { xs: 36, sm: 44, md: 50 }, fontWeight: 800, lineHeight: 1.08, letterSpacing: -1.2 }}
            >
              An AI agent that runs your real Android phone
            </Typography>
            <Typography sx={{ fontSize: { xs: 16.5, md: 18 }, color: 'text.secondary', lineHeight: 1.55 }}>
              Say what you want in plain language. It reads the screen, taps, types and scrolls on a handset you own —
              with your accounts already signed in.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ pt: 0.5 }}>
              <Button component={Link} to="/signup" variant="contained" size="large" disableElevation sx={{ px: 3.5 }}>
                Create a free account
              </Button>
              <Button component={Link} to="/login" size="large" variant="outlined" color="inherit" sx={{ px: 3.5 }}>
                Sign in
              </Button>
            </Stack>
            <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
              Free. One Android phone and an API key from a provider you already use.
            </Typography>
          </Stack>

          <ScrollReveal>
            <RunPreview />
          </ScrollReveal>
        </Box>
      </Container>

      {/* Features */}
      <Box sx={{ borderTop: BORDER, bgcolor: '#f9fafb' }}>
        <Container maxWidth="lg" sx={{ py: { xs: 6, md: 9 } }}>
          <Stack spacing={{ xs: 6, md: 9 }}>
            {FEATURES.map((feature, index) => (
              <ScrollReveal key={feature.title}>
                <Box
                  sx={{
                    display: 'grid',
                    gap: { xs: 3, md: 6 },
                    gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                    alignItems: 'center',
                  }}
                >
                  <Stack spacing={1.5} sx={{ order: { md: index % 2 === 1 ? 2 : 1 } }}>
                    <Typography sx={{ fontSize: { xs: 24, md: 30 }, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.2 }}>
                      {feature.title}
                    </Typography>
                    <Typography sx={{ fontSize: 16.5, color: 'text.secondary', lineHeight: 1.6 }}>
                      {feature.body}
                    </Typography>
                  </Stack>
                  <Box sx={{ order: { md: index % 2 === 1 ? 1 : 2 } }}>
                    <FeatureVisual kind={feature.visual} />
                  </Box>
                </Box>
              </ScrollReveal>
            ))}
          </Stack>
        </Container>
      </Box>

      {/* Why a real phone */}
      <Box sx={{ borderTop: BORDER }}>
        <Container maxWidth="lg" sx={{ py: { xs: 6, md: 9 } }}>
          <ScrollReveal>
            <Box sx={{ maxWidth: 720 }}>
              <Typography sx={{ fontSize: { xs: 24, md: 30 }, fontWeight: 800, letterSpacing: -0.6, mb: 1.5 }}>
                Why a phone you own
              </Typography>
              <Typography sx={{ fontSize: 16.5, color: 'text.secondary', lineHeight: 1.65 }}>
                Most phone agents drive a virtual device in a datacentre, and plenty of apps simply refuse to work
                there. Vector Brain works through the accessibility service on your own handset, so nothing about the
                device looks unusual and your sessions are the real ones. You bring the API key, so the model is yours
                and the cost is whatever your provider charges.
              </Typography>
            </Box>
          </ScrollReveal>
        </Container>
      </Box>

      {/* How it works */}
      <Box sx={{ borderTop: BORDER, bgcolor: '#f9fafb' }}>
        <Container maxWidth="lg" sx={{ py: { xs: 6, md: 9 } }}>
          <Typography sx={{ fontSize: { xs: 24, md: 30 }, fontWeight: 800, letterSpacing: -0.6, mb: { xs: 3.5, md: 5 } }}>
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
              <ScrollReveal key={step.title} delay={index * 90}>
                <Stack spacing={1.25} sx={{ pt: 2, borderTop: '2px solid #111827' }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: 'text.secondary', letterSpacing: 0.8 }}>
                    {String(index + 1).padStart(2, '0')}
                  </Typography>
                  <Typography sx={{ fontSize: 18.5, fontWeight: 800 }}>{step.title}</Typography>
                  <Typography sx={{ fontSize: 15.5, color: 'text.secondary', lineHeight: 1.6 }}>{step.body}</Typography>
                </Stack>
              </ScrollReveal>
            ))}
          </Box>
        </Container>
      </Box>

      {/* Call to action */}
      <Box sx={{ borderTop: BORDER }}>
        <Container maxWidth="lg" sx={{ py: { xs: 7, md: 10 } }}>
          <Stack spacing={2.5} alignItems="flex-start" sx={{ maxWidth: 620 }}>
            <Typography sx={{ fontSize: { xs: 28, md: 36 }, fontWeight: 800, letterSpacing: -1, lineHeight: 1.15 }}>
              Put your phone to work
            </Typography>
            <Typography sx={{ fontSize: 17, color: 'text.secondary', lineHeight: 1.6 }}>
              Create an account, pair a handset, give it a task. Nothing to pay for here — you only pay your own model
              provider.
            </Typography>
            <Button component={Link} to="/signup" variant="contained" size="large" disableElevation sx={{ px: 4 }}>
              Create a free account
            </Button>
          </Stack>
        </Container>
      </Box>

      {/* Footer */}
      <Box component="footer" sx={{ borderTop: BORDER, bgcolor: '#f9fafb' }}>
        <Container maxWidth="lg" sx={{ py: 3.5 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <VectorMark size={20} color="#6b7280" accent="#9ca3af" />
              <Typography sx={{ fontWeight: 700, fontSize: 14.5, color: 'text.secondary' }}>Vector Brain</Typography>
            </Stack>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              © {new Date().getFullYear()} Vector Brain. All rights reserved.
            </Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
