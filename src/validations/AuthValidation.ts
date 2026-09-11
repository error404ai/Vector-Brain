import { z } from 'zod';

// Login validation
export const LoginValidation = z.object({
  email: z.string({ required_error: 'Email is required' }).email({ message: 'Invalid email format' }),
  password: z.string({ required_error: 'Password is required' }).min(6, { message: 'Password must be at least 6 characters' }),
});

export const RefreshTokenValidation = z.object({
  refresh_token: z.string({ required_error: 'Refresh token is required' }).optional(),
});

// Signup validation - supports both regular user and guest signup
// For regular user: name, email, password required
// For guest: all fields optional (isGuest must be true)
export const SignupValidation = z
  .object({
    name: z.string().min(1, 'Name is required').optional(),
    email: z.string().email({ message: 'Invalid email format' }).optional(),
    password: z.string().min(6, { message: 'Password must be at least 6 characters' }).optional(),
    phone: z.string().optional(),
    isGuest: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      // If not a guest signup, name, email, and password are required
      if (!data.isGuest) {
        return data.name && data.email && data.password;
      }
      return true;
    },
    {
      message: 'Name, email, and password are required for regular signup',
      path: ['email'],
    }
  );

/**
 * The credential Google Identity Services hands the browser.
 *
 * Length-bounded so an oversized body is rejected before any parsing work: a
 * real Google ID token is well under 4 KB.
 */
export const GoogleAuthValidation = z.object({
  credential: z.string({ required_error: 'Google credential is required' }).min(20).max(4096),
});
