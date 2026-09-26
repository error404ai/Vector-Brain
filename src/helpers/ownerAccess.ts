import { ForbiddenError } from '@/helpers/AppError';

/**
 * Accounts that see platform-wide tools (run diagnostics) besides admins.
 * The frontend mirrors this list in _helpers/ownerAccess.ts.
 */
export const OWNER_EMAILS = ['r7rewards@gmail.com'];

export type AuthUser = { userId: number; email?: string; role?: string };

export function isOwner(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' || OWNER_EMAILS.includes((user.email ?? '').toLowerCase());
}

export function assertOwner(user: AuthUser | null | undefined, what = 'This page'): void {
  if (!isOwner(user)) throw new ForbiddenError(`${what} is not available on this account`);
}
