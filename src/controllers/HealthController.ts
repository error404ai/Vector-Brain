import { Get, JsonController } from 'routing-controllers';
import { Service } from 'typedi';

@JsonController('/health')
@Service()
export class HealthController {
  @Get('/')
  async healthCheck() {
    return {
      status: 'ok',
      message: 'Server is running',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('/ready')
  async readinessCheck() {
    return {
      status: 'ready',
      message: 'Server is ready to accept requests',
      timestamp: new Date().toISOString(),
    };
  }
}
