import { DeviceFileService } from '@/services/android/DeviceFileService';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, QueryParam } from 'routing-controllers';
import { Service } from 'typedi';

interface QueueFileBody {
  /** One device. Kept so existing callers keep working. */
  device_id?: number;
  /** Several devices in one upload. Takes precedence when both are sent. */
  device_ids?: number[];
  file_name: string;
  mime_type?: string;
  content_base64: string;
}

/**
 * Dashboard side of device file transfer.
 *
 * Kept on its own /android/files prefix instead of nesting under
 * /android/devices/:id so it cannot be shadowed by the existing :id routes on
 * AndroidDeviceController.
 */
@Service()
@JsonController('/android/files')
export class AndroidFileController {
  constructor(private fileService: DeviceFileService) {}

  /** Files queued for one device, newest first. */
  @Authorized()
  @Get('/')
  async listFiles(@QueryParam('device_id') deviceId: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.fileService.listForDashboard(user.userId, Number(deviceId));
  }

  /**
   * Queues a file for delivery.
   *
   * Content arrives base64-encoded in the JSON body. That avoids a multipart
   * parser, which would mean a new dependency, which the frozen lockfile in the
   * Docker build does not allow.
   */
  @Authorized()
  @Post('/')
  async queueFile(@Body() body: QueueFileBody, @CurrentUser({ required: true }) user: { userId: number }) {
    const deviceIds = Array.isArray(body?.device_ids) && body.device_ids.length > 0
      ? body.device_ids.map(Number)
      : [Number(body?.device_id)];

    return this.fileService.queueFile(
      user.userId,
      deviceIds,
      String(body?.file_name || 'file'),
      String(body?.mime_type || 'application/octet-stream'),
      String(body?.content_base64 || ''),
    );
  }

  @Authorized()
  @Delete('/:id')
  async deleteFile(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.fileService.deleteForDashboard(user.userId, Number(id));
  }
}
