import { setIsLoggedIn } from '@/store/authSlice';
import store from '@/store/store';

const authManager = {
  saveToken: (token: string) => {
    try {
      localStorage.setItem('authToken', token);
      // Clear caches from any previous session but keep the new auth token.
      void authManager.clearAppCache(true);
    } catch {
      console.error('Failed to save token');
    }
    store.dispatch(setIsLoggedIn(true));
  },

  getToken: () => {
    return localStorage.getItem('authToken');
  },

  clearToken: () => {
    try {
      localStorage.removeItem('authToken');
      // Clear caches fully on logout (don't preserve token).
      void authManager.clearAppCache(false);
    } catch {
      console.error('Failed to clear token');
    }
    store.dispatch(setIsLoggedIn(false));
  },

  clearAppCache: async (preserveAuthToken = false) => {
    const preservedToken = preserveAuthToken ? localStorage.getItem('authToken') : null;

    sessionStorage.clear();

    const keys: (string | null)[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i));
    }

    for (const k of keys) {
      if (!k) continue;
      if (preserveAuthToken && k === 'authToken') continue;
      localStorage.removeItem(k);
    }

    // Restore token if needed
    if (preservedToken) {
      localStorage.setItem('authToken', preservedToken);
    }
  },

  isAuthenticated: () => {
    return !!authManager.getToken();
  },
};

export default authManager;
