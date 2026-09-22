import { FleetStateService } from '@/services/android/FleetStateService';
import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AndroidDeviceService } from '@/services/android/AndroidDeviceService';
import { AndroidGatewayService } from '@/services/android/AndroidGatewayService';
import { LiveScreenService } from '@/services/android/LiveScreenService';
import { AutomationAction } from '@/services/android/AndroidProtocol';
import { ConfirmPairingValidation, DirectActionValidation, RequestPairingCodeValidation, UpdateDeviceValidation, UpdateDeviceTagValidation } from '@/validations/AndroidDeviceValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Patch, Post, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@JsonController('/android/devices')
export class AndroidDeviceController {
  constructor(
    private deviceService: AndroidDeviceService,
    private gatewayService: AndroidGatewayService,
    private liveScreenService: LiveScreenService,
    private fleetStateService: FleetStateService,
  ) {}

  /**
   * One answer for "what is every phone doing right now?", derived from stored
   * state. Surfaces render this instead of working it out from separate lists.
   */
  @Authorized()
  @Get('/fleet-state')
  async fleetState(@CurrentUser({ required: true }) user: { userId: number }) {
    return { message: 'Fleet state retrieved successfully', data: await this.fleetStateService.getState(user.userId) };
  }

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
   * Rename a device. Two identical handsets are otherwise impossible to tell
   * apart in the device picker.
   */
  @Authorized()
  @Patch('/:id')
  @UseBefore(zodValidationMiddleware(UpdateDeviceValidation))
  async renameDevice(
    @Param('id') id: number,
    @Body() request: z.infer<typeof UpdateDeviceValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.deviceService.renameDevice(id, user.userId, String(request.device_name));
  }

  /**
   * Set the user's own note on a device. An empty string clears it.
   */
  @Authorized()
  @Patch('/:id/tag')
  @UseBefore(zodValidationMiddleware(UpdateDeviceTagValidation))
  async setDeviceTag(
    @Param('id') id: number,
    @Body() request: z.infer<typeof UpdateDeviceTagValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.deviceService.setDeviceTag(id, user.userId, String(request.tag ?? ''));
  }

  /**
   * Keep the live screen flowing while the dashboard is watching.
   *
   * The dashboard calls this when the view opens and repeats it as a
   * keep-alive; the stream stops on its own once the calls stop.
   */
  @Authorized()
  @Post('/:id/watch')
  async watchDevice(
    @Param('id') id: number,
    @Body() body: { interval_ms?: number },
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.liveScreenService.watch(id, user.userId, body?.interval_ms ? Number(body.interval_ms) : undefined);
  }

  @Authorized()
  @Post('/:id/unwatch')
  async unwatchDevice(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.liveScreenService.unwatch(id, user.userId);
  }

  /**
   * Unpair / remove a device.
   */
  @Authorized()
  @Delete('/offline')
  async deleteOffline(@CurrentUser({ required: true }) user: { userId: number }) {
    // Declared before Delete('/:id') so routing-controllers matches the literal
    // /offline path instead of treating "offline" as an id.
    return this.deviceService.deleteOfflineDevices(user.userId);
  }

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
    const startedAt = Date.now();
    const result = await this.gatewayService.executeAction(device.device_id, request.action as AutomationAction);
    // Measured so the live view can show where its delay actually goes: time
    // spent on the phone (capture, encode, upload) versus everything else.
    // base64 carries 3 bytes per 4 characters.
    const frame = 'screenCapture' in result ? result.screenCapture?.base64Data : undefined;
    const frameBytes = frame ? Math.round((frame.length * 3) / 4) : 0;
    return {
      message: 'Direct action executed',
      data: result,
      timing: { device_ms: Date.now() - startedAt, frame_bytes: frameBytes },
    };
  }
}
