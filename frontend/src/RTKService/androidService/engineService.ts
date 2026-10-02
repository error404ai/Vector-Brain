import { baseApi } from '../baseApi';

export type EngineKind = 'eko' | 'vector';

/** When the agent model is shown a screenshot: never beyond unreadable screens, when stuck, or every step. */
export type ScreenshotMode = 'off' | 'stuck' | 'every_step';

export interface EngineSettings {
  kind: EngineKind;
  planner: boolean;
  /** 'account' when this account chose; 'server' when it follows the server default. */
  source: 'account' | 'server';
  /** One of the account's AI configs: reads screens for a text-only model. */
  vision_config_id: number | null;
  /** One of the account's AI configs: takes over when the main model is rate-limited or out of quota. */
  fallback_config_id: number | null;
  screenshots: ScreenshotMode;
}

/** sees: the model reads images; helper: a vision helper reads them for it; blind: no image reaches the AI. */
export interface AgentSightStatus {
  model: string | null;
  model_sees: boolean;
  helper_model: string | null;
  helper_sees: boolean;
  screenshots: ScreenshotMode;
  capability: 'sees' | 'helper' | 'blind';
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
    /** Before a run: can the AI see the phone's screen with the current model, helper and setting. */
    getAgentSight: builder.query<{ data: AgentSightStatus }, void>({
      query: () => ({ url: '/android/agent/sight', method: 'GET' }),
      providesTags: [TAG],
    }),
    setAgentEngine: builder.mutation<{ data: EngineSettings }, { engine?: EngineKind | null; planner?: boolean; vision_config_id?: number | null; fallback_config_id?: number | null; screenshots?: ScreenshotMode | null }>({
      query: (body) => ({ url: '/android/agent/engine', method: 'PUT', body }),
      invalidatesTags: [TAG],
    }),
  }),
});

export const { useGetAgentEngineQuery, useSetAgentEngineMutation, useGetAgentSightQuery } = engineService;
