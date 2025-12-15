import { AgentTask } from '@/entities/AgentTask';
import AppError from '@/helpers/AppError';
import paginate from '@/helpers/paginationHelper';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { AgentTaskListValidation, CreateAgentTaskValidation } from '@/validations/AgentTaskValidation';
import { Service } from 'typedi';
import { FindManyOptions } from 'typeorm';
import z from 'zod';

@Service()
export class AgentTaskService {
  private agentTaskRepository = AppDataSource.getRepository(AgentTask);

  async list(request: z.infer<typeof AgentTaskListValidation>): Promise<ApiResponse> {
    const { page = 1, limit = 10, sortField, sortDirection } = request;

    const findOptions: FindManyOptions<AgentTask> = {};

    // Default sort by created_at descending if no sort specified
    if (sortField) {
      findOptions.order = {
        [sortField]: sortDirection || 'asc',
      };
    } else {
      findOptions.order = {
        created_at: 'desc',
      };
    }

    return await paginate(this.agentTaskRepository, {
      page,
      limit,
      findOptions,
    });
  }

  async details(id: number): Promise<ApiResponse> {
    const agentTask = await this.agentTaskRepository.findOne({
      where: { id },
    });

    if (!agentTask) {
      throw new AppError('Agent task not found', 404);
    }

    return { message: 'Agent task details retrieved successfully', data: agentTask };
  }

  async create(request: z.infer<typeof CreateAgentTaskValidation>, userId: number): Promise<ApiResponse> {
    const agentTask = this.agentTaskRepository.create({
      user_id: userId,
      prompt: request.prompt,
      logs: request.logs,
      steps: request.steps,
      provider: request.provider,
      model: request.model,
      success: request.success ?? false,
      message: request.message,
      total_steps: request.total_steps ?? 0,
      total_duration_seconds: request.total_duration_seconds ?? 0,
      urls_visited: request.urls_visited,
      model_actions: request.model_actions,
      errors: request.errors,
    });

    const savedAgentTask = await this.agentTaskRepository.save(agentTask);

    return { message: 'Agent task created successfully', data: savedAgentTask };
  }

  async delete(id: number): Promise<ApiResponse> {
    const agentTask = await this.agentTaskRepository.findOne({
      where: { id },
    });

    if (!agentTask) {
      throw new AppError('Agent task not found', 404);
    }

    await this.agentTaskRepository.remove(agentTask);

    return { message: 'Agent task deleted successfully' };
  }
}
