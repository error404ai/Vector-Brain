import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AuthService } from '@/services/controllerService/AuthService';
import { LoginValidation } from '@/validations/AuthValidation';
import type { Request, Response } from 'express';
import { Body, CookieParam, CurrentUser, Get, JsonController, Post, Req, Res, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@JsonController('/auth')
@Service()
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('/login')
  @UseBefore(zodValidationMiddleware(LoginValidation))
  async login(@Body() data: z.infer<typeof LoginValidation>, @Req() req: Request, @Res() res: Response) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.socket.remoteAddress;

    const result = await this.authService.login(data, userAgent, ipAddress);

    // Set refresh token in HTTP-only cookie
    if (result.data.refreshToken) {
      res.cookie('refreshToken', result.data.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        path: '/',
      });

      // Remove refresh token from response body (keep it only in cookie)
      const { refreshToken, ...responseData } = result.data;
      return {
        message: result.message,
        data: responseData,
      };
    }

    return result;
  }

  @Post('/refresh-token')
  async refreshToken(@CookieParam('refreshToken') refreshToken: string, @Res() res: Response) {
    if (!refreshToken) {
      res.status(401);
      return { status: 'error', message: 'Refresh token not provided' };
    }

    const result = await this.authService.refreshAccessToken(refreshToken);
    return result;
  }

  @Post('/logout')
  async logout(@CurrentUser({ required: false }) user: { userId: number } | undefined, @CookieParam('refreshToken') refreshToken: string, @Res() res: Response) {
    if (user) {
      await this.authService.logout(user.userId, refreshToken);
    }

    // Clear the refresh token cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    return { message: 'Logged out successfully' };
  }

  @Get('/me')
  async getProfile(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.authService.getProfile(user.userId);
  }
}
