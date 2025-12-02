import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AgentTaskService } from '@/services/controllerService/AgentTaskService';
import { AgentTaskListValidation, CreateAgentTaskValidation } from '@/validations/AgentTaskValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, QueryParams, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@JsonController('/agent-task')
@Authorized()
@Service()
export class AgentTaskController {
  constructor(private agentTaskService: AgentTaskService) {}

  @Get('/list')
  @UseBefore(zodValidationMiddleware(AgentTaskListValidation))
  async getAll(@QueryParams() request: any) {
    return this.agentTaskService.findAll(request);
  }

  @Get('/details/:id')
  async getOne(@Param('id') id: number) {
    return this.agentTaskService.details(id);
  }

  @Post('/create')
  @UseBefore(zodValidationMiddleware(CreateAgentTaskValidation))
  async create(@Body() request: z.infer<typeof CreateAgentTaskValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.agentTaskService.create(request, user.userId);
  }

  @Delete('/delete/:id')
  async delete(@Param('id') id: number) {
    return this.agentTaskService.delete(id);
  }
}
