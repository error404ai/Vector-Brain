import { logout, setIsLoggedIn, setUser, type User } from '@/store/authSlice';
import store from '@/store/store';

const USER_KEY = 'authUser';

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

  saveUser: (user: User) => {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      store.dispatch(setUser(user));
    } catch {
      console.error('Failed to save user');
    }
  },

  getUser: (): User | null => {
    try {
      const user = localStorage.getItem(USER_KEY);
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  },

  clearToken: () => {
    try {
      localStorage.removeItem('authToken');
      localStorage.removeItem(USER_KEY);
      // Clear caches fully on logout (don't preserve token).
      void authManager.clearAppCache(false);
    } catch {
      console.error('Failed to clear token');
    }
    store.dispatch(logout());
  },

  clearAppCache: async (preserveAuthToken = false) => {
    const preservedToken = preserveAuthToken ? localStorage.getItem('authToken') : null;
    const preservedUser = preserveAuthToken ? localStorage.getItem(USER_KEY) : null;

    sessionStorage.clear();

    const keys: (string | null)[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i));
    }

    for (const k of keys) {
      if (!k) continue;
      if (preserveAuthToken && (k === 'authToken' || k === USER_KEY)) continue;
      localStorage.removeItem(k);
    }

    // Restore token and user if needed
    if (preservedToken) {
      localStorage.setItem('authToken', preservedToken);
    }
    if (preservedUser) {
      localStorage.setItem(USER_KEY, preservedUser);
    }
  },

  isAuthenticated: () => {
    return !!authManager.getToken();
  },

  // Initialize auth state from localStorage
  initializeAuth: () => {
    const token = authManager.getToken();
    const user = authManager.getUser();

    if (token && user) {
      store.dispatch(setIsLoggedIn(true));
      store.dispatch(setUser(user));
    } else {
      store.dispatch(setIsLoggedIn(false));
    }
  },
};

export default authManager;
