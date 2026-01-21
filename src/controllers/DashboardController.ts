import { DashboardService } from '@/services/controllerService/DashboardService';
import { Authorized, CurrentUser, Get, JsonController } from 'routing-controllers';
import { Service } from 'typedi';

@Service()
@Authorized()
@JsonController('/dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('/stats')
  async getStats(@CurrentUser({ required: true }) user: { userId: number; email: string; role: string }) {
    return this.dashboardService.getStats(user.userId, user.role);
  }

  @Get('/activity')
  async getRecentActivity(@CurrentUser({ required: true }) user: { userId: number; email: string; role: string }) {
    return this.dashboardService.getRecentActivity(user.userId, user.role);
  }

  @Get('/summary')
  async getSummary(@CurrentUser({ required: true }) user: { userId: number; email: string; role: string }) {
    return this.dashboardService.getSummary(user.userId, user.role);
  }
}
