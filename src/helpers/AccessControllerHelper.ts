import { AiRule } from '../entities/AiRule';
import { Role, User } from '../entities/User';
import { AppDataSource } from '../loaders/database';

export class AccessControllerHelper {
  static async canCreateUser(userId: number): Promise<boolean> {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;
    return user.role === Role.ADMIN;
  }

  static async canDeleteUser(userId: number): Promise<boolean> {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;
    return user.role === Role.ADMIN;
  }

  static async canViewUser(userId: number): Promise<boolean> {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;
    return user.role === Role.ADMIN || user.role === Role.USER;
  }

  static async canUpdateUser(userId: number): Promise<boolean> {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;
    return user.role === Role.ADMIN;
  }

  static async canCreateAiRule(userId: number): Promise<boolean> {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;
    return user.role === Role.ADMIN || user.role === Role.USER;
  }

  static async canViewAiRule(userId: number, ruleId: number): Promise<boolean> {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;

    if (user.role === Role.ADMIN) return true;

    const aiRule = await AppDataSource.getRepository(AiRule).findOne({ where: { id: ruleId } });
    if (!aiRule) return false;

    return aiRule.user_id === userId;
  }

  static async canUpdateAiRule(userId: number, ruleId: number): Promise<boolean> {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;

    if (user.role === Role.ADMIN) return true;

    const aiRule = await AppDataSource.getRepository(AiRule).findOne({ where: { id: ruleId } });
    if (!aiRule) return false;

    return aiRule.user_id === userId;
  }

  static async canDeleteAiRule(userId: number, ruleId: number): Promise<boolean> {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;

    if (user.role === Role.ADMIN) return true;

    const aiRule = await AppDataSource.getRepository(AiRule).findOne({ where: { id: ruleId } });
    if (!aiRule) return false;

    return aiRule.user_id === userId;
  }

  static async canManageAiRules(userId: number): Promise<boolean> {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;
    return user.role === Role.ADMIN;
  }
}
