import { ProxyRotationService } from '@/services/android/ProxyRotationService';
import { AssignProxyValidation, CreateProxyValidation, UpdateProxyValidation } from '@/validations/DeviceProxyValidation';
import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Patch, Post, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import { z } from 'zod';

@Service()
@Authorized()
@JsonController('/device-proxy')
export class DeviceProxyController {
  constructor(private proxyService: ProxyRotationService) {}

  @Get('/')
  async list(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.proxyService.list(user.userId);
  }

  @Post('/')
  @UseBefore(zodValidationMiddleware(CreateProxyValidation))
  async create(
    @Body() request: z.infer<typeof CreateProxyValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.proxyService.create(user.userId, request);
  }

  @Patch('/:id')
  @UseBefore(zodValidationMiddleware(UpdateProxyValidation))
  async update(
    @Param('id') id: number,
    @Body() request: z.infer<typeof UpdateProxyValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.proxyService.update(user.userId, Number(id), request);
  }

  @Delete('/:id')
  async remove(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.proxyService.remove(user.userId, Number(id));
  }

  /** Rotate straight away, for testing a link after adding it. */
  @Post('/:id/rotate')
  async rotateNow(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.proxyService.rotateNow(user.userId, Number(id));
  }

  @Post('/assign')
  @UseBefore(zodValidationMiddleware(AssignProxyValidation))
  async assign(
    @Body() request: z.infer<typeof AssignProxyValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.proxyService.assignDevice(user.userId, request.device_id, request.proxy_id);
  }
}
