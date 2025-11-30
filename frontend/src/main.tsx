import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import App from './App';
import { MantineAppProvider } from './components/providers/MantineProvider';
import './index.css';
import { store } from './store/store';
import authManager from './utils/authManager';

// Initialize auth state from localStorage
authManager.initializeAuth();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <MantineAppProvider>
        <App />
      </MantineAppProvider>
    </Provider>
  </StrictMode>
);
