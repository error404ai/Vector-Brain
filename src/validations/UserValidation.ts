import { z } from 'zod';

// Helper for coercing string query params to numbers
const coerceNumber = (fieldName: string) =>
  z.coerce.number({
    invalid_type_error: `${fieldName} must be a number`,
  });

// Create user validation
export const CreateUserValidation = z.object({
  name: z.string({ required_error: 'Name is required' }).min(1, 'Name is required'),
  email: z.string({ required_error: 'Email is required' }).email({ message: 'Invalid email format' }),
  password: z.string({ required_error: 'Password is required' }).min(6, { message: 'Password must be at least 6 characters' }),
  phone: z.string().optional(),
});

// Update user validation
export const UpdateUserValidation = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  email: z.string().email({ message: 'Invalid email format' }).optional(),
  password: z.string().min(6, { message: 'Password must be at least 6 characters' }).optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
});

// User query validation (for GET list)
export const UserListValidation = z.object({
  page: coerceNumber('Page').min(1, 'Page must be at least 1').optional().default(1),
  limit: coerceNumber('Limit').min(1, 'Limit must be at least 1').optional().default(10),
  search: z.string().optional(),
});
