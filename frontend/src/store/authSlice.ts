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
}

const initialState: AuthState = {
  isLoggedIn: 'initial',
  user: null,
  error: { isError: false, message: '', trace: '' },
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
    },
  },
});

export const { setIsLoggedIn, setUser, setError, clearError, logout } = authSlice.actions;

export default authSlice.reducer;
