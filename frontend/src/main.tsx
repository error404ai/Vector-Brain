import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { Provider } from 'react-redux';
import App from './App';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <Provider store={store}>
        <MUIProvider>
          <App />
        </MUIProvider>
      </Provider>
    </HelmetProvider>
  </StrictMode>
);
