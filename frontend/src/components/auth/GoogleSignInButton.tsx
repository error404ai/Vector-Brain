import { useGetAuthConfigQuery, useGoogleAuthMutation } from '@/RTKService/authService/authService';
import { Alert, Box, Divider, Skeleton, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Matches the sign-in fields, which sit in a 420px card with 32px padding. */
const BUTTON_WIDTH = 320;

interface GoogleSignInButtonProps {
  /** Wording on the button itself. */
  text?: 'signin_with' | 'signup_with' | 'continue_with';
  /** Copy above the divider that separates this from the email form. */
  dividerLabel?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/** Loads Google's script once, however many buttons ask for it. */
let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google script failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google script failed to load'));
    document.head.appendChild(script);
  }).catch((error) => {
    // Let a later mount retry rather than caching the failure forever.
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

/**
 * "Sign in with Google" button.
 *
 * Renders nothing at all when the server reports no client id, so the page is
 * unchanged on a deployment where Google sign-in was never configured. The
 * script comes from Google directly — it cannot be bundled, and adding an npm
 * package is not possible in this build.
 */
export default function GoogleSignInButton({ text = 'continue_with', dividerLabel = 'or' }: GoogleSignInButtonProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { data, isLoading: isConfigLoading } = useGetAuthConfigQuery();
  const [googleAuth] = useGoogleAuthMutation();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const clientId = data?.data?.googleClientId ?? null;

  const handleCredential = useCallback(
    async (credential: string) => {
      setError(null);
      try {
        await googleAuth({ credential }).unwrap();
        navigate('/dashboard');
      } catch (err: unknown) {
        const message =
          typeof err === 'object' && err !== null && 'data' in err
            ? ((err as { data?: { message?: string } }).data?.message ?? null)
            : null;
        setError(message || 'Google sign-in failed. Please try again.');
      }
    },
    [googleAuth, navigate],
  );

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled) return;
        const container = containerRef.current;
        const google = window.google;
        if (!container || !google) return;

        container.innerHTML = '';
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) void handleCredential(response.credential);
          },
          cancel_on_tap_outside: true,
        });
        google.accounts.id.renderButton(container, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          logo_alignment: 'center',
          width: BUTTON_WIDTH,
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load Google sign-in. Check your connection and reload.');
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, handleCredential, text]);

  // Not configured on this server: show nothing rather than a dead button.
  if (!isConfigLoading && !clientId) return null;

  return (
    <Stack spacing={2}>
      <Divider>
        <Typography variant="caption" color="text.secondary">
          {dividerLabel}
        </Typography>
      </Divider>

      <Box sx={{ display: 'flex', justifyContent: 'center', minHeight: 44 }}>
        {!ready && <Skeleton variant="rounded" width={BUTTON_WIDTH} height={44} />}
        <Box ref={containerRef} sx={{ display: ready ? 'block' : 'none' }} />
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
