import { Center, Loader, Stack } from '@mantine/core';

export function GlobalLoader() {
  return (
    <Center
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#f8fafc',
        zIndex: 9999,
      }}
    >
      <Stack align="center" gap="md">
        <Loader size="lg" color="vector" type="dots" />
      </Stack>
    </Center>
  );
}

export default GlobalLoader;
