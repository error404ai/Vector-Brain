import { getRepository } from 'typeorm';
import { Role, User } from '../entities/User';

export class AccessControllerHelper {
  /**
   * Checks if the user with the given userId can create a new user.
   * @param userId The ID of the current user.
   * @returns True if the user can create a user, false otherwise.
   */
  static async canCreateUser(userId: number): Promise<boolean> {
    const user = await getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;
    return user.role === Role.ADMIN;
  }

  /**
   * Checks if the user with the given userId can delete a user.
   * @param userId The ID of the current user.
   * @returns True if the user can delete a user, false otherwise.
   */
  static async canDeleteUser(userId: number): Promise<boolean> {
    const user = await getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;
    return user.role === Role.ADMIN;
  }

  /**
   * Checks if the user with the given userId can view users.
   * @param userId The ID of the current user.
   * @returns True if the user can view users, false otherwise.
   */
  static async canViewUser(userId: number): Promise<boolean> {
    const user = await getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;
    return user.role === Role.ADMIN || user.role === Role.USER;
  }

  /**
   * Checks if the user with the given userId can update a user.
   * @param userId The ID of the current user.
   * @returns True if the user can update a user, false otherwise.
   */
  static async canUpdateUser(userId: number): Promise<boolean> {
    const user = await getRepository(User).findOne({ where: { id: userId } });
    if (!user) return false;
    return user.role === Role.ADMIN;
  }
}
