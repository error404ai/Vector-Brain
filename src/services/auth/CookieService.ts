import { RequestContext } from '@/middleware/requestContext';
import type { CookieOptions, Request, Response } from 'express';
import { Service } from 'typedi';

@Service()
export class CookieService {
  private readonly options: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };

  private get req() {
    const req = RequestContext.get<Request>('req');
    if (!req) {
      throw new Error('Request not available in context');
    }
    return req;
  }

  private get res() {
    const res = RequestContext.get<Response>('res');
    if (!res) {
      throw new Error('Response not available in context');
    }
    return res;
  }

  async setRefreshToken(refreshToken: string) {
    this.res.cookie('RefreshToken', refreshToken, this.options);
  }

  async getRefreshToken(): Promise<string | null> {
    const refreshToken = this.req.cookies?.RefreshToken;
    return refreshToken || null;
  }

  async clearRefreshToken() {
    this.res.clearCookie('RefreshToken', {
      httpOnly: this.options.httpOnly,
      secure: this.options.secure,
      sameSite: this.options.sameSite,
      path: this.options.path,
    });
  }
}
