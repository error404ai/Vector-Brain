import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import SettingService from '@/services/controllerService/SettingService';
import { SettingBulkUpsertValidation, SettingGetValidation, SettingUpsertValidation } from '@/validations/SettingValidation';
import { Body, Get, JsonController, Param, Post, UseBefore } from 'routing-controllers';
import { Container, Service } from 'typedi';
import z from 'zod';

@Service()
@JsonController('/setting')
export class SettingController {
  private settingService = Container.get(SettingService);

  @Get('/list')
  async list() {
    return await this.settingService.list();
  }

  @Get('/get/:key')
  @UseBefore(zodValidationMiddleware(SettingGetValidation))
  async get(@Param('key') key: string) {
    return await this.settingService.get(key);
  }

  @Post('/create-or-update')
  @UseBefore(zodValidationMiddleware(SettingUpsertValidation))
  async createOrUpdate(@Body() request: z.infer<typeof SettingUpsertValidation>) {
    return await this.settingService.createOrUpdate(request);
  }

  @Post('/bulk-create-or-update')
  @UseBefore(zodValidationMiddleware(SettingBulkUpsertValidation))
  async bulkCreateOrUpdate(@Body() request: z.infer<typeof SettingBulkUpsertValidation>) {
    const results: Array<{ status: boolean; message: string; data: any }> = [];
    for (const item of request) {
      const res = await this.settingService.createOrUpdate(item);
      results.push(res);
    }
    return results;
  }
}