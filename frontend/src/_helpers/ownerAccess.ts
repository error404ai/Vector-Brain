/**
 * Accounts that see platform-wide tools (run diagnostics) besides admins.
 * The server enforces the same list in src/helpers/ownerAccess.ts.
 */
const OWNER_EMAILS = ['r7rewards@gmail.com'];

export function isOwner(user?: { role?: string; email?: string } | null): boolean {
  if (!user) return false;
  return user.role === 'admin' || OWNER_EMAILS.includes((user.email ?? '').toLowerCase());
}
