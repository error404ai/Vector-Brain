import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { Provider } from 'react-redux';
import App, { router } from './App';
import authManager from './_helpers/authManager';
import { registerAuthProbe, startClientDiagnostics } from './_helpers/clientDiagnostics';
import { MUIProvider } from './components/providers/MUIProvider';
import './index.css';
import { store } from './store/store';

// Start before anything renders so a crash or hang during boot is caught too.
startClientDiagnostics();
registerAuthProbe(
  () => {
    const state = store.getState();
    const queries = (state.api?.queries ?? {}) as Record<string, { status?: string; error?: { status?: unknown } } | undefined>;
    const profile = Object.entries(queries).find(([key]) => key.startsWith('getProfile'))?.[1];
    return {
      has_token: Boolean(authManager.getAccessToken()),
      auth_initialized: state.auth.authInitialized,
      token_expired: state.auth.tokenExpired,
      user_id: state.auth.user?.id ?? null,
      profile_query: profile ? { status: profile.status ?? null, error_status: profile.error?.status ?? null } : null,
    };
  },
  () => authManager.getAccessToken()
);

const container = document.getElementById('root')!;

// A public page arrives already rendered (scripts/prerender.mjs). Mount only
// once the router has loaded that page's code, so React swaps in identical
// markup in one go instead of flashing the loading fallback over it.
function whenRouterReady(): Promise<void> {
  if (!container.dataset.prerendered || router.state.initialized) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = router.subscribe((state) => {
      if (state.initialized) {
        stop();
        resolve();
      }
    });
  });
}

void whenRouterReady().then(() => createRoot(container).render(
  <StrictMode>
    <HelmetProvider>
      <Provider store={store}>
        <MUIProvider>
          <App />
        </MUIProvider>
      </Provider>
    </HelmetProvider>
  </StrictMode>
));
