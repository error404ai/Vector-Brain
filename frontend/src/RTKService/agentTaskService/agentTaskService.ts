import { baseApi, TAGS } from '../baseApi';

export interface AgentTask {
  id: number;
  user_id: number;
  device_id?: number | null;
  prompt: string;
  logs: string | null;
  steps: string | null;
  provider: string | null;
  model: string | null;
  success: boolean;
  message: string | null;
  total_steps: number;
  total_duration_seconds: number;
  urls_visited: string | null;
  model_actions: string | null;
  errors: string | null;
  created_at: string;
  updated_at: string;
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
 * Parameters for fetching paginated agent task list
 */
export interface GetAgentTasksParams {
  page?: number;
  limit?: number;
  search?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

/**
 * Agent task creation payload
 */
export interface CreateAgentTaskPayload {
  prompt: string;
  logs?: string;
  steps?: string;
}

const agentTaskApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // List agent tasks with pagination - matches /agent-task/list endpoint
    getAgentTasks: builder.query<PaginatedResponse<AgentTask>, GetAgentTasksParams | void>({
      query: (params) => ({
        url: '/agent-task/list',
        method: 'GET',
        params: params || {},
      }),
      providesTags: [TAGS.AGENT_TASKS],
    }),

    // Get single agent task details - matches /agent-task/details/:id endpoint
    getAgentTask: builder.query<{ message: string; data: AgentTask }, number>({
      query: (id) => ({
        url: `/agent-task/details/${id}`,
        method: 'GET',
      }),
      providesTags: (_result, _error, id) => [{ type: TAGS.AGENT_TASK, id }],
    }),

    // Create agent task - matches /agent-task/create endpoint
    createAgentTask: builder.mutation<{ message: string; data: AgentTask }, CreateAgentTaskPayload>({
      query: (data) => ({
        url: '/agent-task/create',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: [TAGS.AGENT_TASKS],
    }),

    // Delete agent task - matches /agent-task/delete/:id endpoint
    deleteAgentTask: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/agent-task/delete/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: [TAGS.AGENT_TASKS],
    }),
  }),
});

export const { useGetAgentTasksQuery, useLazyGetAgentTasksQuery, useGetAgentTaskQuery, useLazyGetAgentTaskQuery, useCreateAgentTaskMutation, useDeleteAgentTaskMutation } = agentTaskApi;

export default agentTaskApi;
