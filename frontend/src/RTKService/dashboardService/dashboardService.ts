import { baseApi, TAGS } from '../baseApi';

export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalAgentTasks: number;
  recentAgentTasks: number;
}

export interface RecentActivity {
  id: number;
  type: 'user' | 'agent_task';
  title: string;
  description: string;
  createdAt: string;
}

export interface DashboardSummary {
  stats: DashboardStats;
  recentActivity: RecentActivity[];
}

const dashboardApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Get dashboard stats
    getDashboardStats: builder.query<{ message: string; data: DashboardStats }, void>({
      query: () => ({
        url: '/dashboard/stats',
        method: 'GET',
      }),
      providesTags: [TAGS.DASHBOARD],
    }),

    // Get recent activity
    getRecentActivity: builder.query<{ message: string; data: RecentActivity[] }, void>({
      query: () => ({
        url: '/dashboard/activity',
        method: 'GET',
      }),
      providesTags: [TAGS.DASHBOARD],
    }),

    // Get dashboard summary (stats + activity combined)
    getDashboardSummary: builder.query<{ message: string; data: DashboardSummary }, void>({
      query: () => ({
        url: '/dashboard/summary',
        method: 'GET',
      }),
      providesTags: [TAGS.DASHBOARD],
    }),
  }),
});

export const { useGetDashboardStatsQuery, useLazyGetDashboardStatsQuery, useGetRecentActivityQuery, useLazyGetRecentActivityQuery, useGetDashboardSummaryQuery, useLazyGetDashboardSummaryQuery } = dashboardApi;

export default dashboardApi;
