import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

export interface NetworkStatusState {
  isNetworkOffline: boolean;
  isServerUnreachable: boolean;
  tokenExpired: boolean;
}

const initialState: NetworkStatusState = {
  isNetworkOffline: false,
  isServerUnreachable: false,
  tokenExpired: false,
};

export const networkStatusSlice = createSlice({
  name: 'networkStatus',
  initialState,
  reducers: {
    setNetworkOffline: (state, action: PayloadAction<boolean>) => {
      state.isNetworkOffline = action.payload;
    },
    setServerUnreachable: (state, action: PayloadAction<boolean>) => {
      state.isServerUnreachable = action.payload;
    },
    setTokenExpired: (state, action: PayloadAction<boolean>) => {
      state.tokenExpired = action.payload;
    },
    clearNetworkError: (state) => {
      state.isNetworkOffline = false;
      state.isServerUnreachable = false;
    },
  },
});

export const { setNetworkOffline, setServerUnreachable, setTokenExpired, clearNetworkError } = networkStatusSlice.actions;

export default networkStatusSlice.reducer;
