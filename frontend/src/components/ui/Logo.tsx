import { Box, Group, Text } from '@mantine/core';
import { IconBrain } from '@tabler/icons-react';

interface LogoProps {
  size?: number;
  showText?: boolean;
}

export function Logo({ size = 32, showText = true }: LogoProps) {
  return (
    <Group gap="xs" align="center">
      <Box
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0B69C6 0%, #22D3EE 100%)',
          borderRadius: 6,
        }}
      >
        <IconBrain size={size * 0.65} color="white" />
      </Box>
      {showText && (
        <Text
          fw={700}
          size="lg"
          style={{
            background: 'linear-gradient(90deg, #0B69C6 0%, #22D3EE 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Vector Brain
        </Text>
      )}
    </Group>
  );
}

export default Logo;
