import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { MissionService } from '@/services/android/MissionService';
import { CreateMissionValidation, RerunMissionValidation } from '@/validations/MissionValidation';
import { Authorized, Body, CurrentUser, Get, JsonController, Param, Post, QueryParam, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@JsonController('/android/missions')
export class MissionController {
  constructor(private missionService: MissionService) {}

  @Authorized()
  @Post('/')
  @UseBefore(zodValidationMiddleware(CreateMissionValidation))
  async create(
    @Body() request: z.infer<typeof CreateMissionValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    // strict: false makes zod infer every key optional; the body is validated.
    return this.missionService.create(user.userId, request as any);
  }

  @Authorized()
  @Get('/')
  async list(@QueryParam('limit') limit: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.missionService.list(user.userId, Number(limit) || 20);
  }

  @Authorized()
  @Get('/:id')
  async get(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.missionService.get(id, user.userId);
  }

  @Authorized()
  @Post('/:id/rerun')
  @UseBefore(zodValidationMiddleware(RerunMissionValidation))
  async rerun(
    @Param('id') id: number,
    @Body() request: z.infer<typeof RerunMissionValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.missionService.rerun(id, user.userId, request as any);
  }

  @Authorized()
  @Post('/:id/cancel')
  async cancel(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.missionService.cancel(id, user.userId);
  }
}
