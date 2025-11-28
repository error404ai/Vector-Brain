import AppError, { ValidationError } from '@/helpers/AppError';
import { NextFunction, Request, Response } from 'express';
import { ExpressErrorMiddlewareInterface, Middleware } from 'routing-controllers';
import { Service } from 'typedi';

@Middleware({ type: 'after' })
@Service()
export class GlobalErrorHandler implements ExpressErrorMiddlewareInterface {
  error(error: any, request: Request, response: Response, next: NextFunction): void {
    let processedError: AppError;

    // Handle routing-controllers validation errors
    if (error.errors && Array.isArray(error.errors)) {
      processedError = ValidationError.fromRoutingControllers(error);
    } else if (error instanceof AppError) {
      processedError = error;
    } else {
      // Handle other types of errors
      const statusCode = error.httpCode || error.status || 500;
      processedError = new AppError(error.message || 'Something went wrong', statusCode);
    }

    const errorResponse = {
      status: 'error',
      status_code: processedError.statusCode,
      message: processedError.message,
      trace: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      data: processedError.data,
    };

    console.error(`API Error (${processedError.statusCode}):`, error);
    if (!response.headersSent) {
      response.status(processedError.statusCode).json(errorResponse);
    } else {
      next(error);
    }
  }
}
