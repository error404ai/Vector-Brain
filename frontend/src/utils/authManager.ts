import newAuthManager from '@/_helpers/authManager';
import { logout, setAuthCheckCompleted, setIsLoggedIn, setUser, type User } from '@/store/authSlice';
import store from '@/store/store';

const USER_KEY = 'authUser';

const authManager = {
  saveToken: (token: string) => {
    try {
      // Use new auth manager to save session
      newAuthManager.saveAccessToken(token);
      // Clear caches from any previous session but keep the new auth token.
      void authManager.clearAppCache(true);
    } catch {
      console.error('Failed to save token');
    }
    store.dispatch(setIsLoggedIn(true));
    store.dispatch(setAuthCheckCompleted(true));
  },

  getToken: () => {
    // Use new auth manager
    return newAuthManager.getAccessToken();
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
      // Use new auth manager
      newAuthManager.clearAccessToken();
      // Clear caches fully on logout (don't preserve token).
      void authManager.clearAppCache(false);
    } catch {
      console.error('Failed to clear token');
    }
    store.dispatch(logout());
    store.dispatch(setAuthCheckCompleted(true));
  },

  clearAppCache: async (preserveAuthToken = false) => {
    const preservedUser = preserveAuthToken ? localStorage.getItem(USER_KEY) : null;

    sessionStorage.clear();

    const keys: (string | null)[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i));
    }

    for (const k of keys) {
      if (!k) continue;
      if (preserveAuthToken && k === USER_KEY) continue;
      localStorage.removeItem(k);
    }

    // Restore user if needed
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
      store.dispatch(setAuthCheckCompleted(true));
    } else {
      store.dispatch(setIsLoggedIn(false));
      store.dispatch(setAuthCheckCompleted(false));
    }
  },
};

export default authManager;
