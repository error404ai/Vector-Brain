import { loaderVisible } from '@/_helpers/clientDiagnostics';
import { Button, Center, Loader, Stack, Text } from '@/components/mui/core';
import { useEffect, useState } from 'react';

const SLOW_AFTER_MS = 15_000;

export function GlobalLoader() {
  const [slow, setSlow] = useState(false);

  // Tells the browser diagnostics how long the full-screen loader stays up;
  // over 10 s it is reported as stuck_loader with a snapshot of the page.
  useEffect(() => {
    loaderVisible(true);
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      loaderVisible(false);
    };
  }, []);

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
        {slow ? (
          <>
            <Text size="sm" c="dimmed">
              Taking longer than usual. This has been reported.
            </Text>
            <Button size="xs" variant="light" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </>
        ) : null}
      </Stack>
    </Center>
  );
}

export default GlobalLoader;
