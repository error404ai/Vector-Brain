/* eslint-disable @typescript-eslint/no-unused-vars */
import { useGetSettingsQuery, useUpdateSettingMutation } from '@/RTKService/settingService/settingService';
import { Button, Box, Card, Group, Stack, Text, Textarea, Title } from '@/components/mui/core';
import { useForm } from '@/components/mui/form';
import { notifications } from '@/components/mui/notifications';
import { IconSettings } from '@/components/mui/icons';

import React from 'react';
import { Helmet } from 'react-helmet-async';

export default function SettingsPage() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [updateSetting, { isLoading: isUpdating }] = useUpdateSettingMutation();

  const systemPromptSetting = settings?.find((s) => s.key === 'systemPromptForEnhancement');

  const form = useForm({
    initialValues: {
      systemPrompt: (systemPromptSetting?.value as string) || '',
    },
  });

  // Update form when settings load
  React.useEffect(() => {
    if (systemPromptSetting) {
      form.setValues({
        systemPrompt: systemPromptSetting.value as string,
      });
    }
  }, [systemPromptSetting, form]);

  const handleSubmit = async (values: typeof form.values) => {
    try {
      await updateSetting({
        key: 'systemPromptForEnhancement',
        value: values.systemPrompt,
      }).unwrap();
      notifications.show({
        title: 'Success',
        message: 'System prompt updated successfully',
        color: 'green',
      });
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: 'Failed to update system prompt',
        color: 'red',
      });
    }
  };

  const cardStyle = {
    backgroundColor: '#ffffff',
    border: '1px solid rgba(0,0,0,0.1)',
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <>
      <Helmet>
        <title>Settings - Vector Brain</title>
      </Helmet>
      <Box p="md">
        <Stack gap="lg">
        <div>
          <Title order={2}>Settings</Title>
          <Text c="dimmed" size="sm">
            Manage your system settings
          </Text>
        </div>

        <Card padding="lg" radius="md" style={cardStyle}>
          <Stack gap="md">
            <Group>
              <IconSettings size="1.5rem" />
              <Title order={4}>AI Settings</Title>
            </Group>
            <form onSubmit={form.onSubmit(handleSubmit)}>
              <Stack gap="md">
                <Textarea label="System Prompt for Prompt Enhancement" description="This prompt is used to enhance user prompts for better AI responses" placeholder="Enter system prompt..." minRows={4} {...form.getInputProps('systemPrompt')} />
                <Group justify="flex-end">
                  <Button type="submit" color="vector" loading={isUpdating}>
                    Save
                  </Button>
                </Group>
              </Stack>
            </form>
          </Stack>
        </Card>
      </Stack>
    </Box>
  </>
);
}
