import dotenv from 'dotenv';
dotenv.config();

class AppError extends Error {
  statusCode = 500;
  status = 'error';
  data: any[] = [];

  constructor(message: string, statusCode?: number, data: any[] = []) {
    super(message);
    this.status = 'error';
    this.statusCode = statusCode || this.statusCode;
    this.data = data;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', data: any[] = []) {
    super(message, 400, data);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', data: any[] = []) {
    super(message, 401, data);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', data: any[] = []) {
    super(message, 403, data);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', data: any[] = []) {
    super(message, 404, data);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', data: any[] = []) {
    super(message, 409, data);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation error', data: any[] = [], statusCode = 400) {
    super(message, statusCode, data);
  }

  /**
   * Creates a ValidationError from routing-controllers validation errors
   */
  static fromRoutingControllers(error: any): ValidationError {
    if (!error.errors || !Array.isArray(error.errors)) {
      return new ValidationError(error.message || 'Validation failed');
    }

    // Format validation errors into a more readable format
    const validationErrors = error.errors.map((err: any) => {
      const constraints = err.constraints || {};
      const messages = Object.values(constraints);
      return {
        field: err.property,
        value: err.value,
        messages: messages
      };
    });

    // Create a more user-friendly message
    const fieldErrors = validationErrors.map((err: any) => 
      `${err.field}: ${err.messages.join(', ')}`
    ).join('; ');
    
    const message = `Validation failed: ${fieldErrors}`;

    return new ValidationError(message, validationErrors);
  }
}

export default AppError;
