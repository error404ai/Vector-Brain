import { JwtHelper } from '@/helpers/JwtHelper';
import { Action } from 'routing-controllers';

interface UserPayload {
  userId: number;
  email: string;
  role: string;
}

export function authorizationChecker(action: Action, roles: string[]): boolean {
  const authHeader = action.request.headers['authorization'];

  if (!authHeader) {
    return false;
  }

  const token = authHeader.replace('Bearer ', '');
  const payload = JwtHelper.verifyToken(token);

  if (!payload) {
    return false;
  }

  // Store user info in request for later use
  action.request.user = payload;

  // If no roles are required, just check if user is authenticated
  if (roles.length === 0) {
    return true;
  }

  // Check if user has required role
  const userRole = (payload as UserPayload).role;
  if (!userRole) {
    return false;
  }

  // Check if user's role is in the required roles list
  return roles.includes(userRole);
}

export function currentUserChecker(action: Action): UserPayload | undefined {
  const authHeader = action.request.headers['authorization'];

  if (!authHeader) {
    return undefined;
  }

  const token = authHeader.replace('Bearer ', '');
  const payload = JwtHelper.verifyToken(token);

  return payload as UserPayload | undefined;
}
