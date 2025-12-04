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

/**
 * Paginated response structure from Vector-Brain backend pagination helper
 */
export interface PaginatedResponse<T> {
  message: string;
  data: T[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    pageSize: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
}

/**
 * Parameters for fetching paginated user list
 */
export interface GetUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

/**
 * User creation payload
 */
export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

/**
 * User update payload
 */
export interface UpdateUserPayload {
  name?: string;
  email?: string;
  password?: string;
  phone?: string;
  isActive?: boolean;
}

const userApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // List users with pagination - matches /users/list endpoint
    getUsers: builder.query<PaginatedResponse<User>, GetUsersParams | void>({
      query: (params) => ({
        url: '/users/list',
        method: 'GET',
        params: params || {},
      }),
      providesTags: [TAGS.USERS],
    }),

    // Get single user details - matches /users/details/:id endpoint
    getUser: builder.query<{ message: string; data: User }, number>({
      query: (id) => ({
        url: `/users/details/${id}`,
        method: 'GET',
      }),
      providesTags: (_result, _error, id) => [{ type: TAGS.USER, id }],
    }),

    // Create user - matches /users/create endpoint
    createUser: builder.mutation<{ message: string; data: User }, CreateUserPayload>({
      query: (data) => ({
        url: '/users/create',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: [TAGS.USERS],
    }),

    // Update user - matches /users/update/:id endpoint
    updateUser: builder.mutation<{ message: string; data: User }, { id: number; data: UpdateUserPayload }>({
      query: ({ id, data }) => ({
        url: `/users/update/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: (_result, _error, { id }) => [{ type: TAGS.USER, id }, TAGS.USERS],
    }),

    // Delete user - matches /users/delete/:id endpoint
    deleteUser: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/users/delete/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: [TAGS.USERS],
    }),
  }),
});

export const { useGetUsersQuery, useLazyGetUsersQuery, useGetUserQuery, useLazyGetUserQuery, useCreateUserMutation, useUpdateUserMutation, useDeleteUserMutation } = userApi;

export default userApi;
