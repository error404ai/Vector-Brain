import authManager from '@/_helpers/authManager';
import { logout } from '@/store/authSlice';
import { baseApi, TAGS } from '../baseApi';

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

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

export interface LoginResponse {
  message: string;
  data: {
    user: User;
    token: string;
    expireAt?: string;
  };
}

export interface SignupResponse {
  message: string;
  data: {
    user: User;
    token: string;
    expireAt?: string;
  };
}

export interface GoogleAuthRequest {
  /** The ID token Google Identity Services returns in its callback. */
  credential: string;
}

export interface AuthConfigResponse {
  message: string;
  data: {
    /** null when the server has no GOOGLE_CLIENT_ID, which hides the button. */
    googleClientId: string | null;
  };
}

export interface ProfileResponse {
  data: User;
}

export interface RefreshTokenResponse {
  status: string;
  message: string;
  data: {
    accessToken: string;
    expire_at: string;
  };
}

const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation<LoginResponse, LoginRequest>({
      query: (credentials) => ({
        url: '/auth/login',
        method: 'POST',
        body: credentials,
      }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await authManager.handleLoginOnQueryStarted(queryFulfilled, dispatch);
      },
    }),

    signup: builder.mutation<SignupResponse, SignupRequest>({
      query: (userData) => ({
        url: '/auth/signup',
        method: 'POST',
        body: userData,
      }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await authManager.handleLoginOnQueryStarted(queryFulfilled, dispatch);
      },
    }),

    googleAuth: builder.mutation<LoginResponse, GoogleAuthRequest>({
      query: (body) => ({
        url: '/auth/google',
        method: 'POST',
        body,
      }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await authManager.handleLoginOnQueryStarted(queryFulfilled, dispatch);
      },
    }),

    getAuthConfig: builder.query<AuthConfigResponse, void>({
      query: () => ({
        url: '/auth/config',
        method: 'GET',
      }),
    }),

    getProfile: builder.query<ProfileResponse, void>({
      query: () => ({
        url: '/auth/me',
        method: 'GET',
      }),
      providesTags: [TAGS.PROFILE, TAGS.ACCOUNT_INFO],
    }),

    logout: builder.mutation<{ message: string }, void>({
      query: () => ({
        url: '/auth/logout',
        method: 'POST',
      }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
          authManager.clearAccessToken();
          dispatch(logout());
        } catch {
          // Still clear tokens on logout even if API fails
          authManager.clearAccessToken();
          dispatch(logout());
        }
      },
      invalidatesTags: [TAGS.ACCOUNT_INFO, TAGS.PROFILE],
    }),

    refreshToken: builder.mutation<RefreshTokenResponse, void>({
      query: () => ({
        url: '/auth/refresh-token',
        method: 'POST',
      }),
    }),
  }),
});

export const {
  useLoginMutation,
  useSignupMutation,
  useGoogleAuthMutation,
  useGetAuthConfigQuery,
  useGetProfileQuery,
  useLazyGetProfileQuery,
  useLogoutMutation,
  useRefreshTokenMutation,
} = authApi;

export default authApi;
