import { RunShareService } from '@/services/android/RunShareService';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post } from 'routing-controllers';
import { Service } from 'typedi';

@Service()
@JsonController('/android/runs')
export class RunShareController {
  constructor(private runShareService: RunShareService) {}

  @Authorized()
  @Get('/:id/share')
  async status(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.runShareService.getShareStatus(id, user.userId);
  }

  @Authorized()
  @Post('/:id/share')
  async share(
    @Param('id') id: number,
    @Body() body: { exclude_steps?: number[] },
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    const exclude = Array.isArray(body?.exclude_steps) ? body.exclude_steps.map(Number) : [];
    return this.runShareService.shareRun(id, user.userId, exclude);
  }

  @Authorized()
  @Delete('/:id/share')
  async unshare(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.runShareService.unshareRun(id, user.userId);
  }
}

/**
 * Public, unauthenticated read of a shared run. Kept in its own controller so
 * it is obvious that nothing here is behind @Authorized.
 */
@Service()
@JsonController('/public/runs')
export class PublicRunController {
  constructor(private runShareService: RunShareService) {}

  @Get('/:token')
  async view(@Param('token') token: string) {
    return this.runShareService.getPublicRun(token);
  }
}
