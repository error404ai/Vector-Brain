import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { ScheduledTaskService } from '@/services/android/ScheduledTaskService';
import { CreateScheduledTaskValidation, UpdateScheduledTaskValidation } from '@/validations/ScheduledTaskValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Patch, Post, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@JsonController('/android/schedules')
export class ScheduledTaskController {
  constructor(private scheduledTaskService: ScheduledTaskService) {}

  @Authorized()
  @Get('/')
  async list(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.scheduledTaskService.listSchedules(user.userId);
  }

  @Authorized()
  @Post('/')
  @UseBefore(zodValidationMiddleware(CreateScheduledTaskValidation))
  async create(
    @Body() request: z.infer<typeof CreateScheduledTaskValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    // The backend compiles with `strict: false`, where zod infers every key as
    // optional even when the schema requires it. Zod has already validated the
    // body at this point, so the cast is safe and keeps the compiler happy.
    return this.scheduledTaskService.createSchedule(user.userId, request as any);
  }

  @Authorized()
  @Patch('/:id')
  @UseBefore(zodValidationMiddleware(UpdateScheduledTaskValidation))
  async update(
    @Param('id') id: number,
    @Body() request: z.infer<typeof UpdateScheduledTaskValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.scheduledTaskService.updateSchedule(id, user.userId, request as any);
  }

  @Authorized()
  @Delete('/:id')
  async remove(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.scheduledTaskService.deleteSchedule(id, user.userId);
  }

  /** Fire a schedule right now, without waiting for its clock time. */
  @Authorized()
  @Post('/:id/run')
  async runNow(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.scheduledTaskService.runNow(id, user.userId);
  }
}
