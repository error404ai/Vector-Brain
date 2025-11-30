import { createSlice } from '@reduxjs/toolkit';

export interface AuthState {
  isLoggedIn: boolean | 'initial';
  error: {
    isError: boolean;
    message: string;
    trace: string;
  };
}

const initialState: AuthState = {
  isLoggedIn: 'initial',
  error: { isError: false, message: '', trace: '' },
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setIsLoggedIn: (state, action) => {
      state.isLoggedIn = action.payload;
    },

    setError: (state, action: { payload: { isError: boolean; message: string; trace: string } }) => {
      state.error = action.payload;
    },

    clearError: (state) => {
      state.error = { isError: false, message: '', trace: '' };
    },
  },
});

export const { setIsLoggedIn, setError, clearError } = authSlice.actions;

export default authSlice.reducer;
