import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

export interface User {
  id: number;
  name: string;
  email: string;
  phone?: string;
  isActive: boolean;
  role: 'admin' | 'user' | 'guest';
  createdAt: string;
  updatedAt: string;
}

export interface AuthState {
  user: User | null;
  error: {
    isError: boolean;
    message: string;
    trace: string;
  };
  tokenExpired: boolean;
  loggingOut: boolean;
  redirectForSelectOrg: boolean;
  longRequestPending: boolean;
  authInitialized: boolean;
}

const initialState: AuthState = {
  user: null,
  error: { isError: false, message: '', trace: '' },
  tokenExpired: false,
  loggingOut: false,
  redirectForSelectOrg: typeof window !== 'undefined' && localStorage.getItem('redirectForSelectOrg') === 'true',
  longRequestPending: false,
  authInitialized: false,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
    },

    setError: (state, action: PayloadAction<{ isError: boolean; message: string; trace: string }>) => {
      state.error = action.payload;
    },

    clearError: (state) => {
      state.error = { isError: false, message: '', trace: '' };
    },

    logout: (state) => {
      state.user = null;
      state.tokenExpired = false;
      state.loggingOut = false;
      state.redirectForSelectOrg = false;
      state.longRequestPending = false;
      state.authInitialized = false;
    },

    setTokenExpired: (state, action: PayloadAction<boolean>) => {
      state.tokenExpired = action.payload;
    },

    setLoggingOut: (state, action: PayloadAction<boolean>) => {
      state.loggingOut = action.payload;
    },

    setRedirectForSelectOrg: (state, action: PayloadAction<boolean>) => {
      state.redirectForSelectOrg = action.payload;
      try {
        localStorage.setItem('redirectForSelectOrg', action.payload.toString());
      } catch {
        // ignore persistence failures
      }
    },

    setLongRequestPending: (state, action: PayloadAction<boolean>) => {
      state.longRequestPending = action.payload;
    },

    setAuthInitialized: (state, action: PayloadAction<boolean>) => {
      state.authInitialized = action.payload;
    },
  },
});

export const { setUser, setError, clearError, logout, setTokenExpired, setLoggingOut, setRedirectForSelectOrg, setLongRequestPending, setAuthInitialized } = authSlice.actions;

export default authSlice.reducer;
