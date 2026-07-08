import type { AiRule } from '@/RTKService/aiRuleService/aiRuleService';
import { ActionIcon, Group, Tooltip } from '@/components/mui/core';
import { IconEdit, IconEye, IconTrash, IconVector } from '@/components/mui/icons';

interface AiRuleActionsProps {
  rule: AiRule;
  onView: (rule: AiRule) => void;
  onEdit: (rule: AiRule) => void;
  onDelete: (rule: AiRule) => void;
  onVectorize?: (rule: AiRule) => void;
}

export function AiRuleActions({ rule, onView, onEdit, onDelete, onVectorize }: AiRuleActionsProps) {
  return (
    <Group gap="xs" justify="center">
      <Tooltip label="View Details">
        <ActionIcon variant="light" color="blue" onClick={() => onView(rule)}>
          <IconEye size="1rem" />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Edit">
        <ActionIcon variant="light" color="yellow" onClick={() => onEdit(rule)}>
          <IconEdit size="1rem" />
        </ActionIcon>
      </Tooltip>
      {onVectorize && !rule.vector_exist && (
        <Tooltip label="Vectorize">
          <ActionIcon variant="light" color="green" onClick={() => onVectorize(rule)}>
            <IconVector size="1rem" />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="Delete">
        <ActionIcon variant="light" color="red" onClick={() => onDelete(rule)}>
          <IconTrash size="1rem" />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
