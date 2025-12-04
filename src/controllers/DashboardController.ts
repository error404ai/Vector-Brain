import { DashboardService } from '@/services/controllerService/DashboardService';
import { Authorized, Get, JsonController } from 'routing-controllers';
import { Service } from 'typedi';

@Service()
@Authorized()
@JsonController('/dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('/stats')
  async getStats() {
    return this.dashboardService.getStats();
  }

  @Get('/activity')
  async getRecentActivity() {
    return this.dashboardService.getRecentActivity();
  }

  @Get('/summary')
  async getSummary() {
    return this.dashboardService.getSummary();
  }
}
