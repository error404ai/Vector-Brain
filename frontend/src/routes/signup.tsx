import { useSignupMutation } from '@/RTKService/authService/authService';
import { Anchor, Button, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { Helmet } from 'react-helmet-async';

export const Route = createFileRoute('/signup')({
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const [signup, { isLoading }] = useSignupMutation();

  const form = useForm({
    initialValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      phone: '',
    },
    validate: {
      name: (value) => (value.length >= 1 ? null : 'Name is required'),
      email: (value) => (/^\S+@\S+$/.test(value) ? null : 'Invalid email'),
      password: (value) => (value.length >= 6 ? null : 'Password must be at least 6 characters'),
      confirmPassword: (value, values) => (value === values.password ? null : 'Passwords do not match'),
    },
  });

  const handleSubmit = async (values: typeof form.values) => {
    try {
      const response = await signup({
        name: values.name,
        email: values.email,
        password: values.password,
        phone: values.phone || undefined,
      }).unwrap();

      notifications.show({
        title: 'Account created!',
        message: `Welcome, ${response.data.user.name}!`,
        color: 'green',
      });

      router.navigate({ to: '/dashboard' });
    } catch (error: unknown) {
      const errorData = error as { data?: { message?: string } };
      const message = errorData?.data?.message || 'Signup failed. Please try again.';
      notifications.show({
        title: 'Signup Failed',
        message,
        color: 'red',
      });
    }
  };

  return (
    <>
      <Helmet>
        <title>Sign Up - Vector Brain</title>
      </Helmet>
      <Stack gap="lg">
        <Stack gap="xs" align="center">
          <Title order={2}>Create Account</Title>
          <Text c="dimmed" size="sm">
            Sign up to get started with Vector Brain
          </Text>
        </Stack>

        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="md">
            <TextInput label="Full Name" placeholder="John Doe" required {...form.getInputProps('name')} />

            <TextInput label="Email" placeholder="your@email.com" required {...form.getInputProps('email')} />

            <TextInput label="Phone (optional)" placeholder="+1 234 567 890" {...form.getInputProps('phone')} />

            <PasswordInput label="Password" placeholder="Your password" required {...form.getInputProps('password')} />

            <PasswordInput label="Confirm Password" placeholder="Confirm your password" required {...form.getInputProps('confirmPassword')} />

            <Button type="submit" fullWidth color="vector" mt="md" loading={isLoading}>
              Create Account
            </Button>
          </Stack>
        </form>

        <Text c="dimmed" size="sm" ta="center">
          Already have an account?{' '}
          <Anchor c="vector" component={Link} to="/login">
            Sign in
          </Anchor>
        </Text>
      </Stack>
    </>
  );
}
