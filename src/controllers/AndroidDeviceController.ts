import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AndroidDeviceService } from '@/services/android/AndroidDeviceService';
import { AndroidGatewayService } from '@/services/android/AndroidGatewayService';
import { AutomationAction } from '@/services/android/AndroidProtocol';
import { ConfirmPairingValidation, DirectActionValidation, RequestPairingCodeValidation } from '@/validations/AndroidDeviceValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@JsonController('/android/devices')
export class AndroidDeviceController {
  constructor(
    private deviceService: AndroidDeviceService,
    private gatewayService: AndroidGatewayService,
  ) {}

  /**
   * Request a 6-digit pairing code from the Web dashboard.
   */
  @Authorized()
  @Post('/pair/request')
  @UseBefore(zodValidationMiddleware(RequestPairingCodeValidation))
  async requestPairingCode(
    @Body() request: z.infer<typeof RequestPairingCodeValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.deviceService.requestPairingCode(request, user.userId);
  }

  /**
   * Called by the Android companion app with the 6-digit pairing code.
   */
  @Post('/pair/confirm')
  @UseBefore(zodValidationMiddleware(ConfirmPairingValidation))
  async confirmPairing(@Body() request: z.infer<typeof ConfirmPairingValidation>) {
    return this.deviceService.confirmPairing(request);
  }

  /**
   * List all paired devices for the current user.
   */
  @Authorized()
  @Get('/')
  async listDevices(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.deviceService.listUserDevices(user.userId);
  }

  /**
   * Unpair / remove a device.
   */
  @Authorized()
  @Delete('/:id')
  async unpairDevice(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    const device = await this.deviceService.getDeviceById(id, user.userId);
    this.gatewayService.disconnectDevice(device.device_id);
    return this.deviceService.unpairDevice(id, user.userId);
  }

  /**
   * Send a manual direct action to a device (e.g. testing Tap, OpenApp, Global Back).
   */
  @Authorized()
  @Post('/action/direct')
  @UseBefore(zodValidationMiddleware(DirectActionValidation))
  async sendDirectAction(
    @Body() request: z.infer<typeof DirectActionValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    const device = await this.deviceService.getDeviceById(request.device_id, user.userId);
    const result = await this.gatewayService.executeAction(device.device_id, request.action as AutomationAction);
    return {
      message: 'Direct action executed',
      data: result,
    };
  }
}
