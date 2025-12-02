import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AgentTaskService } from '@/services/controllerService/AgentTaskService';
import { AgentTaskQueryValidation, CreateAgentTaskValidation } from '@/validations/AgentTaskValidation';
import { Body, CurrentUser, Delete, Get, JsonController, Param, Post, QueryParams, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@JsonController('/agent-tasks')
@Service()
export class AgentTaskController {
  constructor(private agentTaskService: AgentTaskService) {}

  @Get('/')
  @UseBefore(zodValidationMiddleware(AgentTaskQueryValidation))
  async getAll(@QueryParams() query: any) {
    return this.agentTaskService.findAll(query);
  }

  @Get('/:id')
  async getOne(@Param('id') id: number) {
    return this.agentTaskService.findOne(id);
  }

  @Post('/')
  @UseBefore(zodValidationMiddleware(CreateAgentTaskValidation))
  async create(@Body() data: z.infer<typeof CreateAgentTaskValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.agentTaskService.create(data, user.userId);
  }

  @Delete('/:id')
  async delete(@Param('id') id: number) {
    return this.agentTaskService.delete(id);
  }
}
