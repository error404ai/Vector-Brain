import { deviceTokenMiddleware } from '@/middleware/deviceTokenMiddleware';
import { DeviceFileService } from '@/services/android/DeviceFileService';
import { Response } from 'express';
import { Body, Controller, Get, Param, Post, Req, Res, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';

/**
 * Endpoints the Android companion app calls directly.
 *
 * The paths and the response shape are fixed by the shipped app, not chosen
 * here — it builds every URL as {server}/api/android/companion/<path> and sends
 * the permanent device token as a Bearer header.
 *
 * Plain @Controller rather than @JsonController because the content route has to
 * return raw bytes.
 */
@Service()
@Controller('/android/companion')
@UseBefore(deviceTokenMiddleware)
export class AndroidCompanionController {
  constructor(private fileService: DeviceFileService) {}

  /**
   * Files waiting for this device.
   *
   * The app keeps only the entries whose status is PENDING and reads id, name,
   * size and sha256 from each one.
   */
  @Get('/files')
  async listFiles(@Req() req: any) {
    return this.fileService.listPendingForDevice(req.deviceToken.deviceId);
  }

  /**
   * Raw bytes for one file.
   *
   * The app streams this to MediaStore, recomputes the SHA-256 and refuses the
   * file if the digest or the length does not match what the listing promised.
   */
  @Get('/files/:id/content')
  async downloadFile(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const file = await this.fileService.loadForDelivery(req.deviceToken.deviceId, Number(id));

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(file.size_bytes));
    res.setHeader('X-File-Sha256', file.sha256);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.file_name)}"`);
    return res.send(file.content);
  }

  /**
   * Delivery result posted back by the device.
   *
   * The body is treated as advisory: an absent success flag counts as success,
   * because the app only posts a receipt after it has finished writing.
   */
  @Post('/files/:id/receipt')
  async postReceipt(@Param('id') id: string, @Body({ required: false }) body: any, @Req() req: any) {
    const succeeded = body?.success === undefined ? true : Boolean(body.success);
    return this.fileService.recordReceipt(req.deviceToken.deviceId, Number(id), succeeded, body?.message);
  }

  /**
   * Fallback for a receipt posted without the /receipt suffix.
   *
   * The exact shape of that one call could not be read with certainty out of the
   * shipped APK, and accepting both spellings costs nothing.
   */
  @Post('/files/:id')
  async postReceiptAlias(@Param('id') id: string, @Body({ required: false }) body: any, @Req() req: any) {
    return this.postReceipt(id, body, req);
  }
}
