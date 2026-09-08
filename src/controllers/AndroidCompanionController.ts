import { AgentTask } from '@/entities/AgentTask';
import { AndroidDevice } from '@/entities/AndroidDevice';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { deviceTokenMiddleware } from '@/middleware/deviceTokenMiddleware';
import { AiConfigService } from '@/services/controllerService/AiConfigService';
import { AndroidPlannerService } from '@/services/android/AndroidPlannerService';
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
  private taskRepo = AppDataSource.getRepository(AgentTask);
  private logRepo = AppDataSource.getRepository(AndroidTaskLog);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);

  constructor(
    private fileService: DeviceFileService,
    private plannerService: AndroidPlannerService,
    private aiConfigService: AiConfigService,
  ) {}

  /**
   * Resolves the phone's own database row from its token.
   *
   * The token carries the string device_id and the owning user, which is all
   * these routes are allowed to act on — a companion can only ever see its own
   * device's work.
   */
  private async resolveDevice(req: any): Promise<AndroidDevice> {
    const device = await this.deviceRepo.findOne({
      where: { device_id: req.deviceToken.deviceId, user_id: req.deviceToken.userId },
    });
    if (!device) throw new AppError('This device is no longer paired', 404);
    return device;
  }

  /**
   * Whether the phone can actually run something yet.
   *
   * The app blocks its own input box on ai_configured, so without this route it
   * showed "add a key" forever even on an account that had one.
   */
  @Get('/readiness')
  async readiness(@Req() req: any) {
    const config = await this.aiConfigService.resolveActiveConfig(req.deviceToken.userId);
    return {
      success: true,
      data: {
        ai_configured: Boolean(config),
        model: config?.model ?? '',
        provider: config?.provider ?? '',
      },
    };
  }

  /** Recent tasks for this phone, newest first. */
  @Get('/tasks')
  async tasks(@Req() req: any) {
    const device = await this.resolveDevice(req);

    const tasks = await this.taskRepo.find({
      where: { user_id: req.deviceToken.userId, device_id: device.id },
      order: { created_at: 'DESC' },
      take: 20,
      select: {
        id: true,
        prompt: true,
        message: true,
        success: true,
        model: true,
        total_steps: true,
        total_duration_seconds: true,
        created_at: true,
      },
    });

    const running = this.plannerService.getActiveTaskIds();

    return {
      success: true,
      data: tasks.map((task) => ({
        id: task.id,
        prompt: task.prompt,
        message: task.message ?? '',
        // The app switches on this string, so it is derived here rather than
        // leaving the phone to work it out from a boolean and a running list.
        status: running.includes(task.id) ? 'RUNNING' : task.success ? 'COMPLETED' : 'FAILED',
        total_steps: task.total_steps ?? 0,
        model: task.model ?? '',
        total_duration_seconds: task.total_duration_seconds ?? 0,
        token_usage: null,
      })),
    };
  }

  /** Starts a task typed on the phone itself. */
  @Post('/run')
  async run(@Body() body: { prompt?: string; task_id?: number }, @Req() req: any) {
    const prompt = String(body?.prompt || '').trim();
    if (prompt.length < 4) throw new AppError('Give the task a few more words', 400);

    const device = await this.resolveDevice(req);
    const result = await this.plannerService.runTask(
      prompt,
      device.id,
      req.deviceToken.userId,
      undefined,
      body?.task_id ? Number(body.task_id) : undefined,
    );

    return { success: true, message: 'Task started', data: (result as any)?.data ?? result };
  }

  /** Stops a running task from the phone. */
  @Post('/cancel/:taskId')
  async cancel(@Param('taskId') taskId: string, @Req() req: any) {
    await this.resolveDevice(req);
    const result = await this.plannerService.cancelTask(Number(taskId), req.deviceToken.userId);
    return { success: true, message: 'Task cancelled', data: (result as any)?.data ?? null };
  }

  /** Steps of one task, for the phone's task detail sheet. */
  @Get('/logs/:taskId')
  async logs(@Param('taskId') taskId: string, @Req() req: any) {
    const device = await this.resolveDevice(req);

    const task = await this.taskRepo.findOne({
      where: { id: Number(taskId), user_id: req.deviceToken.userId, device_id: device.id },
    });
    if (!task) throw new AppError('Task not found', 404);

    const logs = await this.logRepo.find({
      where: { agent_task_id: task.id },
      order: { step_index: 'ASC' },
      take: 200,
      select: {
        step_index: true,
        action_type: true,
        status: true,
        result_message: true,
      },
    });

    return { success: true, data: logs };
  }

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
