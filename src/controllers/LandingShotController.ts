import { LandingShotService } from '@/services/android/LandingShotService';
import { Response } from 'express';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Patch, Post, Res } from 'routing-controllers';
import { Service } from 'typedi';

/** Admin tools for the screenshots the public landing page shows. */
@Service()
@Authorized('admin')
@JsonController('/landing-shots')
export class LandingShotController {
  constructor(private shots: LandingShotService) {}

  @Get('/')
  async list() {
    return this.shots.list();
  }

  /** Full-resolution capture of each listed phone. */
  @Post('/capture')
  async capture(@Body() body: { device_ids?: number[] }, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.shots.capturePhones(user.userId, Array.isArray(body?.device_ids) ? body.device_ids : []);
  }

  /** Copies a mission's saved final screens (the latest mission when no id is given). */
  @Post('/import-mission')
  async importMission(@Body({ required: false }) body: { mission_id?: number }, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.shots.importMission(user.userId, body?.mission_id ? Number(body.mission_id) : undefined);
  }

  /** A capture of one of the app's pages, taken in the browser. */
  @Post('/page')
  async page(@Body() body: { image?: string; label?: string }, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.shots.uploadPage(user.userId, body?.image ?? '', body?.label ?? '');
  }

  @Patch('/:id')
  async update(@Param('id') id: number, @Body() body: { slot?: string | null; approved?: boolean; label?: string }) {
    return this.shots.update(Number(id), body ?? {});
  }

  @Delete('/:id')
  async remove(@Param('id') id: number) {
    return this.shots.remove(Number(id));
  }

  @Get('/:id/image')
  async image(@Param('id') id: number, @Res() res: Response) {
    const { mime, bytes } = await this.shots.image(Number(id), false);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.end(bytes);
  }
}

/**
 * Public, unauthenticated reads for the landing page: approved shots only.
 * Kept apart so it is obvious nothing here sits behind @Authorized.
 */
@Service()
@JsonController('/public/landing-shots')
export class PublicLandingShotController {
  constructor(private shots: LandingShotService) {}

  @Get('/')
  async list(@Res() res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json(await this.shots.publicList());
  }

  @Get('/:id/image')
  async image(@Param('id') id: number, @Res() res: Response) {
    const { mime, bytes } = await this.shots.image(Number(id), true);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(bytes);
  }
}
