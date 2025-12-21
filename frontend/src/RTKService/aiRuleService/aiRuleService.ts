/* eslint-disable @typescript-eslint/no-explicit-any */
import { baseApi, TAGS } from '../baseApi';

export interface AiRule {
  id: number;
  user_id: number | null;
  name: string;
  rule?: string;
  website?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  vector_exist?: boolean;
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
 * Generic API response
 */
export interface ApiResponse<T = any> {
  message: string;
  data?: T;
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
  rule: string;
  website?: string;
  is_active?: boolean;
  is_global?: boolean;
}

/**
 * AI rule update payload
 */
export interface UpdateAiRulePayload {
  name?: string;
  rule?: string;
  website?: string;
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
  rule: string | null;
  website: string | null;
  is_active: boolean;
  similarity_score: number;
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

/**
 * Export AI rules parameters
 */
export interface ExportAiRulesParams {
  ids?: number[];
}

/**
 * Import AI rules payload
 */
export interface ImportAiRulesPayload {
  rules: Omit<CreateAiRulePayload, 'is_active'> & { is_active?: boolean }[];
  deleteExisting?: boolean;
}

/**
 * Import response
 */
export interface ImportAiRulesResponse {
  message: string;
  data: {
    imported: number;
    failed: number;
    errors: { name: string; error: string }[];
  };
}

/**
 * Bulk delete payload
 */
export interface BulkDeleteAiRulesPayload {
  ids: number[];
}

/**
 * Bulk delete response
 */
export interface BulkDeleteAiRulesResponse {
  message: string;
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
        body: { prompt: params.query, limit: params.limit },
      }),
    }),

    // Backfill vector embeddings - matches /ai-rules/backfill-vectors endpoint
    backfillVectors: builder.mutation<BackfillResponse, void>({
      query: () => ({
        url: '/ai-rules/backfill-vectors',
        method: 'POST',
      }),
    }),

    // Vectorize single AI rule - matches /ai-rules/vectorize/:id endpoint
    vectorizeAiRule: builder.mutation<ApiResponse, number>({
      query: (id) => ({
        url: `/ai-rules/vectorize/${id}`,
        method: 'POST',
      }),
      invalidatesTags: [TAGS.AI_RULES],
    }),

    // Export AI rules - matches /ai-rules/export endpoint
    exportAiRules: builder.query<{ message: string; data: Omit<AiRule, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'vector_exist'>[] }, ExportAiRulesParams | void>({
      query: (params) => ({
        url: '/ai-rules/export',
        method: 'GET',
        params: params?.ids ? { ids: params.ids.join(',') } : {},
      }),
    }),

    // Import AI rules - matches /ai-rules/import endpoint
    importAiRules: builder.mutation<ImportAiRulesResponse, ImportAiRulesPayload>({
      query: (data) => ({
        url: '/ai-rules/import',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: [TAGS.AI_RULES],
    }),

    // Bulk delete AI rules - matches /ai-rules/bulk-delete endpoint
    bulkDeleteAiRules: builder.mutation<BulkDeleteAiRulesResponse, BulkDeleteAiRulesPayload>({
      query: (data) => ({
        url: '/ai-rules/bulk-delete',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: [TAGS.AI_RULES],
    }),
  }),
});

export const { useGetAiRulesQuery, useLazyGetAiRulesQuery, useGetAiRuleQuery, useLazyGetAiRuleQuery, useCreateAiRuleMutation, useUpdateAiRuleMutation, useDeleteAiRuleMutation, useSearchAiRulesMutation, useBackfillVectorsMutation, useVectorizeAiRuleMutation, useLazyExportAiRulesQuery, useImportAiRulesMutation, useBulkDeleteAiRulesMutation } = aiRuleApi;

export default aiRuleApi;
