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
}

const initialState: AuthState = {
  isLoggedIn: 'initial',
  user: null,
  error: { isError: false, message: '', trace: '' },
  hasCheckedAuth: false,
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
    },

    setAuthCheckCompleted: (state, action: PayloadAction<boolean>) => {
      state.hasCheckedAuth = action.payload;
    },
  },
});

export const { setIsLoggedIn, setUser, setError, clearError, logout, setAuthCheckCompleted } = authSlice.actions;

export default authSlice.reducer;
