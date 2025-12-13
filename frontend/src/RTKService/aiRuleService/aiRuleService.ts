import { baseApi, TAGS } from '../baseApi';

export interface AiRule {
  id: number;
  user_id: number;
  name: string;
  description?: string;
  rule?: string;
  is_active: boolean;
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
 * Parameters for fetching paginated AI rule list
 */
export interface GetAiRulesParams {
  page?: number;
  limit?: number;
  search?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

/**
 * AI rule creation payload
 */
export interface CreateAiRulePayload {
  name: string;
  description?: string;
  rule?: string;
  is_active?: boolean;
}

/**
 * AI rule update payload
 */
export interface UpdateAiRulePayload {
  name?: string;
  description?: string;
  rule?: string;
  is_active?: boolean;
}

/**
 * Semantic search parameters
 */
export interface SemanticSearchParams {
  query: string;
  limit?: number;
}

/**
 * Search result with similarity score
 */
export interface AiRuleSearchResult {
  id: number;
  name: string;
  description: string | null;
  rule: string | null;
  is_active: boolean;
  score: number;
}

/**
 * Semantic search response
 */
export interface SemanticSearchResponse {
  message: string;
  data: AiRuleSearchResult[];
}

/**
 * Backfill response
 */
export interface BackfillResponse {
  message: string;
  data: {
    processed: number;
    failed: number;
  };
}

const aiRuleApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // List AI rules with pagination - matches /ai-rules/list endpoint
    getAiRules: builder.query<PaginatedResponse<AiRule>, GetAiRulesParams | void>({
      query: (params) => ({
        url: '/ai-rules/list',
        method: 'GET',
        params: params || {},
      }),
      providesTags: [TAGS.AI_RULES],
    }),

    // Get single AI rule details - matches /ai-rules/details/:id endpoint
    getAiRule: builder.query<{ message: string; data: AiRule }, number>({
      query: (id) => ({
        url: `/ai-rules/details/${id}`,
        method: 'GET',
      }),
      providesTags: (_result, _error, id) => [{ type: TAGS.AI_RULE, id }],
    }),

    // Create AI rule - matches /ai-rules/create endpoint
    createAiRule: builder.mutation<{ message: string; data: AiRule }, CreateAiRulePayload>({
      query: (data) => ({
        url: '/ai-rules/create',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: [TAGS.AI_RULES],
    }),

    // Update AI rule - matches /ai-rules/update/:id endpoint
    updateAiRule: builder.mutation<{ message: string; data: AiRule }, { id: number; data: UpdateAiRulePayload }>({
      query: ({ id, data }) => ({
        url: `/ai-rules/update/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: (_result, _error, { id }) => [{ type: TAGS.AI_RULE, id }, TAGS.AI_RULES],
    }),

    // Delete AI rule - matches /ai-rules/delete/:id endpoint
    deleteAiRule: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/ai-rules/delete/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: [TAGS.AI_RULES],
    }),

    // Semantic search AI rules - matches /ai-rules/search endpoint
    searchAiRules: builder.mutation<SemanticSearchResponse, SemanticSearchParams>({
      query: (params) => ({
        url: '/ai-rules/search',
        method: 'POST',
        body: params,
      }),
    }),

    // Backfill vector embeddings - matches /ai-rules/backfill-vectors endpoint
    backfillVectors: builder.mutation<BackfillResponse, void>({
      query: () => ({
        url: '/ai-rules/backfill-vectors',
        method: 'POST',
      }),
    }),
  }),
});

export const { useGetAiRulesQuery, useLazyGetAiRulesQuery, useGetAiRuleQuery, useLazyGetAiRuleQuery, useCreateAiRuleMutation, useUpdateAiRuleMutation, useDeleteAiRuleMutation, useSearchAiRulesMutation, useBackfillVectorsMutation } = aiRuleApi;

export default aiRuleApi;
