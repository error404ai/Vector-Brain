import { Badge } from '@/components/mui/core';

interface UserStatusBadgeProps {
  isActive?: boolean;
}

/**
 * UserStatusBadge component
 * Displays user active/inactive status as a badge
 */
export function UserStatusBadge({ isActive = true }: UserStatusBadgeProps) {
  return (
    <Badge color={isActive ? 'green' : 'gray'} variant="light" size="sm">
      {isActive ? 'Active' : 'Inactive'}
    </Badge>
  );
}
