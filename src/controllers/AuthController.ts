import { AuthService } from '@/services/controllerService/AuthService';
import { LoginDto } from '@/validations/AuthValidation';
import { Body, CurrentUser, Get, JsonController, Post } from 'routing-controllers';
import { Service } from 'typedi';

@JsonController('/auth')
@Service()
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('/login')
  async login(@Body() data: LoginDto) {
    return this.authService.login(data);
  }

  @Get('/me')
  async getProfile(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.authService.getProfile(user.userId);
  }
}
