import { AgentTask } from '@/entities/AgentTask';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { AgentTaskListValidation, CreateAgentTaskValidation } from '@/validations/AgentTaskValidation';
import { Service } from 'typedi';
import z from 'zod';

@Service()
export class AgentTaskService {
  private agentTaskRepository = AppDataSource.getRepository(AgentTask);

  async findAll(request: z.infer<typeof AgentTaskListValidation>): Promise<ApiResponse> {
    const { page = 1, limit = 10 } = request;
    const skip = (page - 1) * limit;

    const queryBuilder = this.agentTaskRepository.createQueryBuilder('agentTask');

    const [agentTasks, total] = await queryBuilder.skip(skip).take(limit).getManyAndCount();

    return {
      message: 'Agent tasks retrieved successfully',
      data: agentTasks,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async details(id: number): Promise<ApiResponse> {
    const agentTask = await this.agentTaskRepository.findOne({
      where: { id },
      relations: ['user'],
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
