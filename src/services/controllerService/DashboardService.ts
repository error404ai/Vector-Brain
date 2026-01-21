import { AgentTask } from '@/entities/AgentTask';
import { AiRule } from '@/entities/AiRule';
import { User } from '@/entities/User';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { Service } from 'typedi';
import { IsNull, MoreThan } from 'typeorm';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalAgentTasks: number;
  recentAgentTasks: number;
  totalAiRules: number;
}

interface RecentActivity {
  id: number;
  type: 'user' | 'agent_task';
  title: string;
  description: string;
  createdAt: Date;
}

@Service()
export class DashboardService {
  private userRepository = AppDataSource.getRepository(User);
  private agentTaskRepository = AppDataSource.getRepository(AgentTask);
  private aiRuleRepository = AppDataSource.getRepository(AiRule);

  async getStats(userId: number, userRole: string): Promise<ApiResponse> {
    const isAdmin = userRole === 'admin';

    let stats: DashboardStats;

    if (isAdmin) {
      // Admin sees all system statistics
      const totalUsers = await this.userRepository.count({
        where: { deletedAt: IsNull() },
      });

      const activeUsers = await this.userRepository.count({
        where: { deletedAt: IsNull(), isActive: true },
      });

      const totalAgentTasks = await this.agentTaskRepository.count();

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentAgentTasks = await this.agentTaskRepository.count({
        where: { created_at: MoreThan(thirtyDaysAgo) },
      });

      const totalAiRules = await this.aiRuleRepository.count();

      stats = {
        totalUsers,
        activeUsers,
        totalAgentTasks,
        recentAgentTasks,
        totalAiRules,
      };
    } else {
      // Regular users see only their own statistics
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const userAgentTasks = await this.agentTaskRepository.count({
        where: { user_id: userId },
      });

      const recentAgentTasks = await this.agentTaskRepository.count({
        where: { user_id: userId, created_at: MoreThan(thirtyDaysAgo) },
      });

      const userAiRules = await this.aiRuleRepository.count({
        where: { user_id: userId },
      });

      stats = {
        totalUsers: 0,
        activeUsers: 0,
        totalAgentTasks: userAgentTasks,
        recentAgentTasks,
        totalAiRules: userAiRules,
      };
    }

    return {
      message: 'Dashboard stats retrieved successfully',
      data: stats,
    };
  }

  async getRecentActivity(userId: number, userRole: string): Promise<ApiResponse> {
    const activities: RecentActivity[] = [];
    const isAdmin = userRole === 'admin';

    if (isAdmin) {
      // Admin sees all recent activities
      const recentUsers = await this.userRepository.find({
        where: { deletedAt: IsNull() },
        order: { created_at: 'DESC' },
        take: 5,
      });

      for (const user of recentUsers) {
        activities.push({
          id: user.id,
          type: 'user',
          title: 'New user registered',
          description: `${user.name} joined the platform`,
          createdAt: user.created_at,
        });
      }

      const recentTasks = await this.agentTaskRepository.find({
        order: { created_at: 'DESC' },
        take: 5,
      });

      for (const task of recentTasks) {
        activities.push({
          id: task.id,
          type: 'agent_task',
          title: 'Agent task created',
          description: task.prompt.substring(0, 50) + (task.prompt.length > 50 ? '...' : ''),
          createdAt: task.created_at,
        });
      }
    } else {
      // Regular users see only their own activities
      const recentTasks = await this.agentTaskRepository.find({
        where: { user_id: userId },
        order: { created_at: 'DESC' },
        take: 10,
      });

      for (const task of recentTasks) {
        activities.push({
          id: task.id,
          type: 'agent_task',
          title: 'Agent task created',
          description: task.prompt.substring(0, 50) + (task.prompt.length > 50 ? '...' : ''),
          createdAt: task.created_at,
        });
      }
    }

    activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const topActivities = activities.slice(0, 10);

    return {
      message: 'Recent activity retrieved successfully',
      data: topActivities,
    };
  }

  async getSummary(userId: number, userRole: string): Promise<ApiResponse> {
    const [statsResponse, activityResponse] = await Promise.all([
      this.getStats(userId, userRole),
      this.getRecentActivity(userId, userRole),
    ]);

    return {
      message: 'Dashboard summary retrieved successfully',
      data: {
        stats: statsResponse.data,
        recentActivity: activityResponse.data,
      },
    };
  }
}
