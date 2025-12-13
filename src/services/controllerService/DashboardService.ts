import { AgentTask } from '@/entities/AgentTask';
import { User } from '@/entities/User';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { Service } from 'typedi';
import { IsNull } from 'typeorm';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalAgentTasks: number;
  recentAgentTasks: number;
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

  async getStats(): Promise<ApiResponse> {
    // Get user statistics
    const totalUsers = await this.userRepository.count({
      where: { deletedAt: IsNull() },
    });

    const activeUsers = await this.userRepository.count({
      where: { deletedAt: IsNull(), isActive: true },
    });

    // Get agent task statistics
    const totalAgentTasks = await this.agentTaskRepository.count();

    // Get tasks created in the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentAgentTasks = await this.agentTaskRepository.createQueryBuilder('task').where('task.created_at >= :date', { date: sevenDaysAgo }).getCount();

    // Calculate percentage changes (mock for now - can be enhanced with historical data)
    const stats: DashboardStats = {
      totalUsers,
      activeUsers,
      totalAgentTasks,
      recentAgentTasks,
    };

    return {
      message: 'Dashboard stats retrieved successfully',
      data: stats,
    };
  }

  async getRecentActivity(): Promise<ApiResponse> {
    const activities: RecentActivity[] = [];

    const recentUsers = await this.userRepository.find({
      where: { deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    for (const user of recentUsers) {
      activities.push({
        id: user.id,
        type: 'user',
        title: 'New user registered',
        description: `${user.name} joined the platform`,
        createdAt: user.createdAt,
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

    activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const topActivities = activities.slice(0, 10);

    return {
      message: 'Recent activity retrieved successfully',
      data: topActivities,
    };
  }

  async getSummary(): Promise<ApiResponse> {
    const [statsResponse, activityResponse] = await Promise.all([this.getStats(), this.getRecentActivity()]);

    return {
      message: 'Dashboard summary retrieved successfully',
      data: {
        stats: statsResponse.data,
        recentActivity: activityResponse.data,
      },
    };
  }
}
