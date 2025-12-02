import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AuthService } from '@/services/controllerService/AuthService';
import { LoginValidation, RefreshTokenValidation } from '@/validations/AuthValidation';
import type { Request } from 'express';
import { Body, CurrentUser, Get, JsonController, Post, Req, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@JsonController('/auth')
@Service()
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('/login')
  @UseBefore(zodValidationMiddleware(LoginValidation))
  async login(@Body() data: z.infer<typeof LoginValidation>, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.socket.remoteAddress;

    return this.authService.login(data, userAgent, ipAddress);
  }

  @Post('/refresh-token')
  @UseBefore(zodValidationMiddleware(RefreshTokenValidation))
  async refreshToken(@Body() data: z.infer<typeof RefreshTokenValidation>) {
    return this.authService.refreshAccessToken(data);
  }

  @Post('/logout')
  async logout(@CurrentUser({ required: false }) user: { userId: number } | undefined) {
    return this.authService.logout(user?.userId);
  }

  @Get('/me')
  async getProfile(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.authService.getProfile(user.userId);
  }
}
