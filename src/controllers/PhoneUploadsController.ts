import { AndroidDeviceStatus } from '@/entities/AndroidDevice';
import { AuthUser } from '@/helpers/ownerAccess';
import AppError from '@/helpers/AppError';
import { AndroidDeviceService } from '@/services/android/AndroidDeviceService';
import { AndroidGatewayService } from '@/services/android/AndroidGatewayService';
import { DeviceUploadService } from '@/services/android/DeviceUploadService';
import { Response } from 'express';
import { Authorized, Body, Controller, CurrentUser, Delete, Get, Param, Post, QueryParam, Res } from 'routing-controllers';
import { Service } from 'typedi';

/** Files phones sent up (companion 0.32): list, download, delete. */
@Service()
@Authorized()
@Controller('/android/uploads')
export class PhoneUploadsController {
  constructor(
    private uploads: DeviceUploadService,
    private devices: AndroidDeviceService,
    private gateway: AndroidGatewayService,
  ) {}

  /**
   * Notification access and All files access per online phone (companion 0.32
   * reports both). can_enable: the phone can switch them on by itself.
   */
  @Get('/access')
  async access(@CurrentUser({ required: true }) user: AuthUser) {
    const listed = (await this.devices.listUserDevices(user.userId)).data as { id: number; device_id: string; device_name: string; status: AndroidDeviceStatus }[];
    const rows = listed
      .filter((d) => d.status === AndroidDeviceStatus.ONLINE)
      .map((d) => {
        const access = this.gateway.accessOf(d.device_id);
        return {
          device_id: d.id,
          device_name: d.device_name,
          notifications: access?.notifications ?? null,
          files: access?.files ?? null,
          can_enable: this.gateway.hasFeature(d.device_id, 'enable_access'),
        };
      });
    return { data: rows };
  }

  /** Asks one phone to switch on Notification access or All files access itself. */
  @Post('/access')
  async enableAccess(@Body() body: { device_id?: number; access?: string }, @CurrentUser({ required: true }) user: AuthUser) {
    const access = body?.access === 'NOTIFICATIONS' || body?.access === 'FILES' ? body.access : null;
    if (!access || !Number(body?.device_id)) throw new AppError('device_id and access (NOTIFICATIONS or FILES) are required', 400);
    const device = await this.devices.getDeviceById(Number(body.device_id), user.userId);
    if (!this.gateway.hasFeature(device.device_id, 'enable_access')) throw new AppError('This phone needs Vector 0.33 or newer to do this by itself. Open Vector on the phone, Setup, and turn it on there.', 400);
    const result = await this.gateway.executeAction(device.device_id, { type: 'EnableAccess', access }, 45_000);
    const ok = result.status === 'SUCCESS';
    if (ok) this.gateway.noteAccess(device.device_id, access === 'FILES' ? 'files' : 'notifications', true);
    return { data: { ok, message: result.status === 'SUCCESS' ? result.summary : result.status === 'FAILURE' ? result.message : 'Cancelled' } };
  }

  @Get('/')
  async list(@QueryParam('device_id') deviceId: number, @CurrentUser({ required: true }) user: AuthUser, @Res() res: Response) {
    const rows = await this.uploads.list(user.userId, Number(deviceId) || undefined);
    return res.json({ data: rows.map((r) => ({ id: r.id, device_id: r.device_id, device_name: r.device_name, file_name: r.file_name, mime_type: r.mime_type, size_bytes: r.size_bytes, created_at: r.created_at })) });
  }

  @Get('/:id/content')
  async content(@Param('id') id: number, @CurrentUser({ required: true }) user: AuthUser, @Res() res: Response) {
    const upload = await this.uploads.owned(user.userId, Number(id));
    res.setHeader('Content-Type', upload.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(upload.size_bytes));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(upload.file_name)}`);
    for await (const chunk of this.uploads.read(upload.id)) {
      if (res.destroyed) break;
      res.write(chunk);
    }
    res.end();
    return res;
  }

  @Delete('/:id')
  async remove(@Param('id') id: number, @CurrentUser({ required: true }) user: AuthUser, @Res() res: Response) {
    await this.uploads.delete(user.userId, Number(id));
    return res.json({ message: 'Deleted' });
  }
}
