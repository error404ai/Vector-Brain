import { Skeleton, Stack } from '@mantine/core';

export function DashboardSkeleton() {
  return (
    <Stack gap="md" p="md">
      <Skeleton height={60} radius="sm" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
        <Skeleton height={120} radius="sm" />
        <Skeleton height={120} radius="sm" />
        <Skeleton height={120} radius="sm" />
      </div>
      <Skeleton height={300} radius="sm" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
        <Skeleton height={200} radius="sm" />
        <Skeleton height={200} radius="sm" />
      </div>
    </Stack>
  );
}

export default DashboardSkeleton;
