import { z } from 'zod';

// Login validation
export const LoginValidation = z.object({
  email: z.string({ required_error: 'Email is required' }).email({ message: 'Invalid email format' }),
  password: z.string({ required_error: 'Password is required' }).min(6, { message: 'Password must be at least 6 characters' }),
});

export const RefreshTokenValidation = z.object({
  refresh_token: z.string({ required_error: 'Refresh token is required' }).optional(),
});
