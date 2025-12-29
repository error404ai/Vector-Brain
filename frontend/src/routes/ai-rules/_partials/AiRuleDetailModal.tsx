import type { AiRule } from '@/RTKService/aiRuleService/aiRuleService';
import { Badge, Box, Code, Group, Modal, Stack, Text } from '@mantine/core';

interface AiRuleDetailModalProps {
  rule: AiRule | undefined;
  opened: boolean;
  onClose: () => void;
}

export function AiRuleDetailModal({ rule, opened, onClose }: AiRuleDetailModalProps) {
  if (!rule) return null;

  return (
    <Modal opened={opened} onClose={onClose} title="AI Rule Details" size="lg">
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Rule ID
          </Text>
          <Badge variant="light" color="blue">
            #{rule.id}
          </Badge>
        </Group>

        <Box>
          <Text size="sm" c="dimmed" mb="xs">
            Name
          </Text>
          <Text size="sm">{rule.name}</Text>
        </Box>

        {rule.intent && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Intent
            </Text>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {rule.intent}
            </Text>
          </Box>
        )}

        {rule.website && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Website
            </Text>
            <Text size="sm">{rule.website}</Text>
          </Box>
        )}

        {rule.rule && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Rule
            </Text>
            <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {rule.rule}
            </Code>
          </Box>
        )}

        <Box>
          <Text size="sm" c="dimmed" mb="xs">
            Active
          </Text>
          <Badge color={rule.is_active ? 'green' : 'red'}>{rule.is_active ? 'Yes' : 'No'}</Badge>
        </Box>

        <Box>
          <Text size="sm" c="dimmed" mb="xs">
            Created At
          </Text>
          <Text size="sm">{new Date(rule.created_at).toLocaleString()}</Text>
        </Box>

        <Box>
          <Text size="sm" c="dimmed" mb="xs">
            Updated At
          </Text>
          <Text size="sm">{new Date(rule.updated_at).toLocaleString()}</Text>
        </Box>
      </Stack>
    </Modal>
  );
}
