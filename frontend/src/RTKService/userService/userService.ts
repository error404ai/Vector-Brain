import { baseApi, TAGS } from '../baseApi';

export interface User {
  id: number;
  name: string;
  email: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface GetUsersParams {
  page?: number;
  limit?: number;
  search?: string;
}

const userApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getUsers: builder.query<PaginatedResponse<User>, GetUsersParams | void>({
      query: (params) => ({
        url: '/users',
        method: 'GET',
        params: params || {},
      }),
      providesTags: [TAGS.USERS],
    }),

    getUser: builder.query<{ data: User }, number>({
      query: (id) => ({
        url: `/users/${id}`,
        method: 'GET',
      }),
      providesTags: (_result, _error, id) => [{ type: TAGS.USER, id }],
    }),

    createUser: builder.mutation<{ data: User }, Partial<User>>({
      query: (data) => ({
        url: '/users',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: [TAGS.USERS],
    }),

    updateUser: builder.mutation<{ data: User }, { id: number; data: Partial<User> }>({
      query: ({ id, data }) => ({
        url: `/users/${id}`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: (_result, _error, { id }) => [{ type: TAGS.USER, id }, TAGS.USERS],
    }),

    deleteUser: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/users/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: [TAGS.USERS],
    }),
  }),
});

export const { useGetUsersQuery, useLazyGetUsersQuery, useGetUserQuery, useLazyGetUserQuery, useCreateUserMutation, useUpdateUserMutation, useDeleteUserMutation } = userApi;

export default userApi;
