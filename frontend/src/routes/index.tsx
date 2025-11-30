import { setIsLoggedIn } from '@/store/authSlice';
import authManager from '@/utils/authManager';
import { Anchor, Button, Checkbox, Group, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useDispatch } from 'react-redux';

export const Route = createFileRoute('/')({
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const dispatch = useDispatch();

  const form = useForm({
    initialValues: {
      email: '',
      password: '',
      rememberMe: false,
    },
    validate: {
      email: (value) => (/^\S+@\S+$/.test(value) ? null : 'Invalid email'),
      password: (value) => (value.length >= 6 ? null : 'Password must be at least 6 characters'),
    },
  });

  const handleSubmit = (values: typeof form.values) => {
    console.log('Login attempt:', values);
    // Simulate login - replace with actual API call
    authManager.saveToken('demo-token-123');
    dispatch(setIsLoggedIn(true));
    router.navigate({ to: '/dashboard' });
  };

  return (
    <Stack gap="lg">
      <Stack gap="xs" align="center">
        <Title order={2}>Welcome Back</Title>
        <Text c="dimmed" size="sm">
          Sign in to access your Vector Brain dashboard
        </Text>
      </Stack>

      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput label="Email" placeholder="your@email.com" required {...form.getInputProps('email')} />

          <PasswordInput label="Password" placeholder="Your password" required {...form.getInputProps('password')} />

          <Group justify="space-between">
            <Checkbox label="Remember me" {...form.getInputProps('rememberMe', { type: 'checkbox' })} />
            <Anchor c="vector" size="sm" href="#">
              Forgot password?
            </Anchor>
          </Group>

          <Button type="submit" fullWidth color="vector" mt="md">
            Sign In
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
