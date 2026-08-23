import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { browserWorkerErrorRateLimit } from '@/middleware/browserWorkerErrorRateLimit';
import { BrowserWorkerErrorService } from '@/services/controllerService/BrowserWorkerErrorService';
import { BrowserWorkerErrorListValidation, ReportBrowserWorkerErrorsValidation } from '@/validations/BrowserWorkerErrorValidation';
import { Authorized, Body, Delete, Get, JsonController, Param, Post, QueryParams, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@JsonController('/browserworker-error')
export class BrowserWorkerErrorController {
  constructor(private browserWorkerErrorService: BrowserWorkerErrorService) {}

  @Post('/report')
  @UseBefore(browserWorkerErrorRateLimit)
  @UseBefore(zodValidationMiddleware(ReportBrowserWorkerErrorsValidation))
  async report(@Body() request: z.infer<typeof ReportBrowserWorkerErrorsValidation>) {
    return this.browserWorkerErrorService.report(request);
  }

  @Authorized(['admin'])
  @Get('/list')
  @UseBefore(zodValidationMiddleware(BrowserWorkerErrorListValidation))
  async list(@QueryParams() request: any) {
    return this.browserWorkerErrorService.list(request);
  }

  @Authorized(['admin'])
  @Get('/summary')
  async summary() {
    return this.browserWorkerErrorService.summary();
  }

  @Authorized(['admin'])
  @Get('/details/:id')
  async details(@Param('id') id: number) {
    return this.browserWorkerErrorService.details(id);
  }

  @Authorized(['admin'])
  @Delete('/delete/:id')
  async delete(@Param('id') id: number) {
    return this.browserWorkerErrorService.delete(id);
  }
}
