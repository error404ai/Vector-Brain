import GoogleSignInButton from '@/components/auth/GoogleSignInButton';
import { useSignupMutation } from '@/RTKService/authService/authService';
import { useForm } from '@/components/mui/form';
import { notifications } from '@/components/mui/notifications';
import { Button, CircularProgress, Link as MuiLink, Stack, TextField, Typography } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

export default function SignupPage() {
  const navigate = useNavigate();
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

      navigate('/dashboard');
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

  const nameInput = form.getInputProps('name');
  const emailInput = form.getInputProps('email');
  const phoneInput = form.getInputProps('phone');
  const passwordInput = form.getInputProps('password');
  const confirmPasswordInput = form.getInputProps('confirmPassword');

  return (
    <>
      <Helmet>
        <title>Sign Up - Vector Brain</title>
      </Helmet>
      <Stack spacing={3}>
        <Stack spacing={0.75} alignItems="center" textAlign="center">
          <Typography variant="h4" component="h1" sx={{ fontSize: { xs: 28, sm: 30 }, fontWeight: 800, lineHeight: 1.15 }}>
            Create Account
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 15, lineHeight: 1.45 }}>
            Sign up to get started with Vector Brain
          </Typography>
        </Stack>

        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack spacing={2.25}>
            <TextField
              label="Full Name"
              placeholder="John Doe"
              required
              fullWidth
              autoComplete="name"
              value={nameInput.value}
              onChange={nameInput.onChange}
              error={Boolean(nameInput.error)}
              helperText={nameInput.error || undefined}
            />

            <TextField
              label="Email"
              placeholder="your@email.com"
              required
              fullWidth
              autoComplete="email"
              value={emailInput.value}
              onChange={emailInput.onChange}
              error={Boolean(emailInput.error)}
              helperText={emailInput.error || undefined}
            />

            <TextField
              label="Phone (optional)"
              placeholder="+1 234 567 890"
              fullWidth
              autoComplete="tel"
              value={phoneInput.value}
              onChange={phoneInput.onChange}
              error={Boolean(phoneInput.error)}
              helperText={phoneInput.error || undefined}
            />

            <TextField
              label="Password"
              placeholder="Your password"
              required
              fullWidth
              type="password"
              autoComplete="new-password"
              value={passwordInput.value}
              onChange={passwordInput.onChange}
              error={Boolean(passwordInput.error)}
              helperText={passwordInput.error || undefined}
            />

            <TextField
              label="Confirm Password"
              placeholder="Confirm your password"
              required
              fullWidth
              type="password"
              autoComplete="new-password"
              value={confirmPasswordInput.value}
              onChange={confirmPasswordInput.onChange}
              error={Boolean(confirmPasswordInput.error)}
              helperText={confirmPasswordInput.error || undefined}
            />

            <Button type="submit" fullWidth variant="contained" size="large" disabled={isLoading} sx={{ height: 44, fontSize: 15, fontWeight: 700, boxShadow: 'none' }}>
              {isLoading ? <CircularProgress size={20} color="inherit" /> : 'Create Account'}
            </Button>
          </Stack>
        </form>

        <GoogleSignInButton text="signup_with" dividerLabel="or sign up with" />

        <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ fontSize: 14 }}>
          Already have an account?{' '}
          <MuiLink component={Link} to="/login" underline="hover" sx={{ fontWeight: 500 }}>
            Sign in
          </MuiLink>
        </Typography>
      </Stack>
    </>
  );
}
