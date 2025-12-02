import { AgentTask } from '@/entities/AgentTask';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { AgentTaskQueryValidation, CreateAgentTaskValidation } from '@/validations/AgentTaskValidation';
import { Service } from 'typedi';
import z from 'zod';

@Service()
export class AgentTaskService {
  private agentTaskRepository = AppDataSource.getRepository(AgentTask);

  async findAll(query: z.infer<typeof AgentTaskQueryValidation>) {
    const { page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const queryBuilder = this.agentTaskRepository.createQueryBuilder('agentTask');

    const [agentTasks, total] = await queryBuilder.skip(skip).take(limit).getManyAndCount();

    return {
      data: agentTasks,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const agentTask = await this.agentTaskRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!agentTask) {
      throw new AppError('Agent task not found', 404);
    }

    return { data: agentTask };
  }

  async create(data: z.infer<typeof CreateAgentTaskValidation>, userId: number) {
    const agentTask = this.agentTaskRepository.create({
      user_id: userId,
      prompt: data.prompt,
    });

    const savedAgentTask = await this.agentTaskRepository.save(agentTask);

    return { data: savedAgentTask };
  }

  async delete(id: number) {
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
