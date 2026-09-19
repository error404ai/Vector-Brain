import { DeviceFileService } from '@/services/android/DeviceFileService';
import AppError from '@/helpers/AppError';
import { Request } from 'express';
import {
  Authorized,
  Body,
  CurrentUser,
  Delete,
  Get,
  JsonController,
  Param,
  Post,
  QueryParam,
  Req,
} from 'routing-controllers';
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

interface InitUploadBody {
  device_id?: number;
  device_ids?: number[];
  file_name: string;
  mime_type?: string;
  size_bytes: number;
  sha256: string;
  total_chunks: number;
}

/**
 * Dashboard side of device file transfer.
 *
 * Two upload paths sit here. Small files (< 12 MB) still post base64 in a JSON
 * body through POST /android/files. Anything larger — an APK for auto-update —
 * goes through the chunked flow: init reserves an upload, chunk streams raw
 * bytes, finish assembles and queues. The chunk route takes raw
 * application/octet-stream (wired via express.raw in app.ts), so an APK is never
 * base64-inflated and never trips the 50 MB JSON ceiling.
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

  /** Small-file upload: base64 in a JSON body. */
  @Authorized()
  @Post('/')
  async queueFile(@Body() body: QueueFileBody, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.fileService.queueFile(
      user.userId,
      this.deviceIdsOf(body),
      String(body?.file_name || 'file'),
      String(body?.mime_type || 'application/octet-stream'),
      String(body?.content_base64 || ''),
    );
  }

  /** Opens a chunked upload for a large file and returns its upload_id. */
  @Authorized()
  @Post('/init')
  async initUpload(@Body() body: InitUploadBody, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.fileService.initUpload(
      user.userId,
      this.deviceIdsOf(body),
      String(body?.file_name || 'file'),
      String(body?.mime_type || 'application/octet-stream'),
      Number(body?.size_bytes),
      String(body?.sha256 || ''),
      Number(body?.total_chunks),
    );
  }

  /**
   * One raw chunk of a chunked upload.
   *
   * The body is raw bytes, not JSON — express.raw has already turned it into a
   * Buffer on req.body by the time this runs. upload_id and index ride in the
   * query string so the body stays pure payload.
   */
  @Authorized()
  @Post('/chunk')
  async uploadChunk(
    @QueryParam('upload_id') uploadId: string,
    @QueryParam('index') index: number,
    @Req() req: Request,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    const chunk = req.body;
    if (!Buffer.isBuffer(chunk)) {
      throw new AppError('Chunk body must be raw binary (application/octet-stream)', 400);
    }
    return this.fileService.appendChunk(user.userId, String(uploadId || ''), Number(index), chunk);
  }

  /** Assembles a finished chunked upload and queues it for its devices. */
  @Authorized()
  @Post('/finish')
  async finishUpload(
    @Body() body: { upload_id: string },
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.fileService.finishUpload(user.userId, String(body?.upload_id || ''));
  }

  @Authorized()
  @Delete('/:id')
  async deleteFile(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.fileService.deleteForDashboard(user.userId, Number(id));
  }

  private deviceIdsOf(body: { device_id?: number; device_ids?: number[] }): number[] {
    return Array.isArray(body?.device_ids) && body.device_ids.length > 0
      ? body.device_ids.map(Number)
      : [Number(body?.device_id)];
  }
}
