/**
 * TEMPORARY: besides admins, these accounts see the landing-shot tools
 * (capture buttons, Landing shots page, Capture this page) while the first
 * real screenshots are collected. The server enforces the same list in
 * LandingShotController; remove both once that is done.
 */
const LANDING_SHOT_EMAILS = ['r7rewards@gmail.com'];

export function canManageLandingShots(user?: { role?: string; email?: string } | null): boolean {
  if (!user) return false;
  return user.role === 'admin' || LANDING_SHOT_EMAILS.includes((user.email ?? '').toLowerCase());
}
