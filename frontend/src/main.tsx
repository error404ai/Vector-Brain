import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { Provider } from 'react-redux';
import App from './App';
import { MantineAppProvider } from './components/providers/MantineProvider';
import './index.css';
import { store } from './store/store';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <Provider store={store}>
        <MantineAppProvider>
          <App />
        </MantineAppProvider>
      </Provider>
    </HelmetProvider>
  </StrictMode>
);
