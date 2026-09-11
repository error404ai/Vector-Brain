import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AuthService } from '@/services/controllerService/AuthService';
import { GoogleAuthValidation, LoginValidation, RefreshTokenValidation, SignupValidation } from '@/validations/AuthValidation';
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
  async login(@Body() request: z.infer<typeof LoginValidation>, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.socket.remoteAddress;

    return this.authService.login(request, userAgent, ipAddress);
  }

  @Post('/signup')
  @UseBefore(zodValidationMiddleware(SignupValidation))
  async signup(@Body() request: z.infer<typeof SignupValidation>, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.socket.remoteAddress;

    return this.authService.signup(request, userAgent, ipAddress);
  }

  /** Exchange a Google ID token for a Vector Brain session. */
  @Post('/google')
  @UseBefore(zodValidationMiddleware(GoogleAuthValidation))
  async googleAuth(@Body() request: z.infer<typeof GoogleAuthValidation>, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.socket.remoteAddress;

    return this.authService.googleAuth(request, userAgent, ipAddress);
  }

  /** Public: tells the browser whether Google sign-in is available, and its client id. */
  @Get('/config')
  getAuthConfig() {
    return this.authService.getPublicAuthConfig();
  }

  @Post('/refresh-token')
  @UseBefore(zodValidationMiddleware(RefreshTokenValidation))
  async refreshToken(@Body() request: z.infer<typeof RefreshTokenValidation>) {
    return this.authService.refreshAccessToken(request);
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
