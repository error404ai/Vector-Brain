import { useLoginMutation } from '@/RTKService/authService/authService';
import { Anchor, Button, Checkbox, Group, PasswordInput, Stack, Text, TextInput, Title } from '@/components/mui/core';
import { useForm } from '@/components/mui/form';
import { notifications } from '@/components/mui/notifications';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

export default function LoginPage() {
  const navigate = useNavigate();
  const [login, { isLoading }] = useLoginMutation();

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

  const handleSubmit = async (values: typeof form.values) => {
    try {
      const response = await login({
        email: values.email,
        password: values.password,
      }).unwrap();

      notifications.show({
        title: 'Welcome back!',
        message: `Logged in as ${response.data.user.name}`,
        color: 'green',
      });

      navigate('/dashboard');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      notifications.show({
        title: 'Login Failed',
        message,
        color: 'red',
      });
    }
  };

  return (
    <>
      <Helmet>
        <title>Login - Vector Brain</title>
      </Helmet>
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

            <Button type="submit" fullWidth color="vector" mt="md" loading={isLoading}>
              Sign In
            </Button>
          </Stack>
        </form>

        <Text c="dimmed" size="sm" ta="center">
          Do not have an account?{' '}
          <Anchor c="vector" component={Link} to="/signup">
            Sign up
          </Anchor>
        </Text>
      </Stack>
    </>
  );
}
