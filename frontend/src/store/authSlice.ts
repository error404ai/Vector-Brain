import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

export interface User {
  id: number;
  name: string;
  email: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthState {
  isLoggedIn: boolean | 'initial';
  user: User | null;
  error: {
    isError: boolean;
    message: string;
    trace: string;
  };
  hasCheckedAuth: boolean;
  tokenExpired: boolean;
  loggingOut: boolean;
  redirectForSelectOrg: boolean;
  longRequestPending: boolean;
  authInitialized: boolean;
}

const initialState: AuthState = {
  isLoggedIn: 'initial',
  user: null,
  error: { isError: false, message: '', trace: '' },
  hasCheckedAuth: false,
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
    setIsLoggedIn: (state, action: PayloadAction<boolean>) => {
      state.isLoggedIn = action.payload;
    },

    setUser: (state, action: PayloadAction<User | null>) => {
      state.user = action.payload;
    },

    setError: (state, action: PayloadAction<{ isError: boolean; message: string; trace: string }>) => {
      state.error = action.payload;
    },

    clearError: (state) => {
      state.error = { isError: false, message: '', trace: '' };
    },

    logout: (state) => {
      state.isLoggedIn = false;
      state.user = null;
      state.hasCheckedAuth = true;
      state.tokenExpired = false;
      state.loggingOut = false;
      state.redirectForSelectOrg = false;
      state.longRequestPending = false;
      state.authInitialized = false;
    },

    setAuthCheckCompleted: (state, action: PayloadAction<boolean>) => {
      state.hasCheckedAuth = action.payload;
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

export const { setIsLoggedIn, setUser, setError, clearError, logout, setAuthCheckCompleted, setTokenExpired, setLoggingOut, setRedirectForSelectOrg, setLongRequestPending, setAuthInitialized } = authSlice.actions;

export default authSlice.reducer;
