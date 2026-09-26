import { baseApi } from '../baseApi';

export type EngineKind = 'eko' | 'vector';

export interface EngineSettings {
  kind: EngineKind;
  planner: boolean;
  /** 'account' when this account chose; 'server' when it follows the server default. */
  source: 'account' | 'server';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tag types are not declared centrally (same as the other services)
const TAG = 'AGENT_ENGINE' as any;

/** Which engine drives the model for this account's runs. */
export const engineService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAgentEngine: builder.query<{ data: EngineSettings }, void>({
      query: () => ({ url: '/android/agent/engine', method: 'GET' }),
      providesTags: [TAG],
    }),
    setAgentEngine: builder.mutation<{ data: EngineSettings }, { engine?: EngineKind | null; planner?: boolean }>({
      query: (body) => ({ url: '/android/agent/engine', method: 'PUT', body }),
      invalidatesTags: [TAG],
    }),
  }),
});

export const { useGetAgentEngineQuery, useSetAgentEngineMutation } = engineService;
