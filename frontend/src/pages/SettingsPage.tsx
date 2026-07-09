import { useGetSettingsQuery, useUpdateSettingMutation } from '@/RTKService/settingService/settingService';
import PageHeader from '@/components/ui/PageHeader';
import SaveIcon from '@mui/icons-material/Save';
import SettingsIcon from '@mui/icons-material/Settings';
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [updateSetting, { isLoading: isUpdating }] = useUpdateSettingMutation();
  const systemPromptSetting = settings?.find((setting) => setting.key === 'systemPromptForEnhancement');
  const [systemPrompt, setSystemPrompt] = useState('');

  useEffect(() => {
    if (systemPromptSetting) {
      setSystemPrompt(String(systemPromptSetting.value ?? ''));
    }
  }, [systemPromptSetting]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await updateSetting({ key: 'systemPromptForEnhancement', value: systemPrompt }).unwrap();
      toast.success('System prompt updated successfully');
    } catch {
      toast.error('Failed to update system prompt');
    }
  };

  return (
    <>
      <Helmet>
        <title>Settings - Vector Brain</title>
      </Helmet>

      <PageHeader title="Settings" subtitle="Manage the AI configuration used across your workspace." />

      <Paper sx={{ p: { xs: 2, md: 2.5 }, maxWidth: 920 }}>
        <Stack spacing={2.25}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#fff' }}>
              <SettingsIcon />
            </Box>
            <Box>
              <Typography variant="h6">AI Settings</Typography>
              <Typography variant="body2" color="text.secondary">
                Configure the prompt enhancer behavior.
              </Typography>
            </Box>
          </Stack>

          {isLoading ? (
            <Stack alignItems="center" sx={{ py: 5 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : (
            <Box component="form" onSubmit={handleSubmit}>
              <Stack spacing={2}>
                <Alert severity="info" variant="outlined">
                  This prompt is used to improve user prompts before they are sent to the AI workflow.
                </Alert>
                <TextField
                  label="System Prompt for Prompt Enhancement"
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  placeholder="Enter system prompt..."
                  multiline
                  minRows={8}
                  fullWidth
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit" variant="contained" startIcon={<SaveIcon />} disabled={isUpdating}>
                    Save
                  </Button>
                </Box>
              </Stack>
            </Box>
          )}
        </Stack>
      </Paper>
    </>
  );
}
