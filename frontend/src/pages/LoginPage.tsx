import { useLoginMutation } from '@/RTKService/authService/authService';
import { useForm } from '@/components/mui/form';
import { notifications } from '@/components/mui/notifications';
import { Box, Button, Checkbox, CircularProgress, FormControlLabel, Link as MuiLink, Stack, TextField, Typography } from '@mui/material';
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

  const emailInput = form.getInputProps('email');
  const passwordInput = form.getInputProps('password');
  const rememberMeInput = form.getInputProps('rememberMe', { type: 'checkbox' });

  return (
    <>
      <Helmet>
        <title>Login - Vector Brain</title>
      </Helmet>
      <Stack spacing={3}>
        <Stack spacing={0.75} alignItems="center" textAlign="center">
          <Typography variant="h4" component="h1" sx={{ fontSize: { xs: 28, sm: 30 }, fontWeight: 800, lineHeight: 1.15 }}>
            Welcome Back
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 15, lineHeight: 1.45 }}>
            Sign in to access your Vector Brain dashboard
          </Typography>
        </Stack>

        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack spacing={2.25}>
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
              label="Password"
              placeholder="Your password"
              required
              fullWidth
              type="password"
              autoComplete="current-password"
              value={passwordInput.value}
              onChange={passwordInput.onChange}
              error={Boolean(passwordInput.error)}
              helperText={passwordInput.error || undefined}
            />

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
              <FormControlLabel
                control={<Checkbox checked={Boolean(rememberMeInput.checked)} onChange={rememberMeInput.onChange} size="small" />}
                label="Remember me"
                sx={{
                  m: 0,
                  '& .MuiFormControlLabel-label': { fontSize: 14, color: 'text.primary' },
                }}
              />
              <MuiLink href="#" underline="hover" sx={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>
                Forgot password?
              </MuiLink>
            </Box>

            <Button type="submit" fullWidth variant="contained" size="large" disabled={isLoading} sx={{ height: 44, fontSize: 15, fontWeight: 700, boxShadow: 'none' }}>
              {isLoading ? <CircularProgress size={20} color="inherit" /> : 'Sign In'}
            </Button>
          </Stack>
        </form>

        <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ fontSize: 14 }}>
          Do not have an account?{' '}
          <MuiLink component={Link} to="/signup" underline="hover" sx={{ fontWeight: 500 }}>
            Sign up
          </MuiLink>
        </Typography>
      </Stack>
    </>
  );
}
