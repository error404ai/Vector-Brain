import { AuthUser } from '@/helpers/ownerAccess';
import { DeviceUploadService } from '@/services/android/DeviceUploadService';
import { Response } from 'express';
import { Authorized, Controller, CurrentUser, Delete, Get, Param, QueryParam, Res } from 'routing-controllers';
import { Service } from 'typedi';

/** Files phones sent up (companion 0.32): list, download, delete. */
@Service()
@Authorized()
@Controller('/android/uploads')
export class PhoneUploadsController {
  constructor(private uploads: DeviceUploadService) {}

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
