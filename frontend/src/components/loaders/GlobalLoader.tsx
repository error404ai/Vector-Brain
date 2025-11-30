import { Center, Loader, Stack, Text } from '@mantine/core';

interface GlobalLoaderProps {
  message?: string;
}

export function GlobalLoader({ message = 'Loading...' }: GlobalLoaderProps) {
  return (
    <Center
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#091E38',
        zIndex: 9999,
      }}
    >
      <Stack align="center" gap="md">
        <Loader size="lg" color="vector" type="dots" />
        <Text c="dimmed" size="sm">
          {message}
        </Text>
      </Stack>
    </Center>
  );
}

export default GlobalLoader;
