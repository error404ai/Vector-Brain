import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { UserService } from '@/services/controllerService/UserService';
import { CreateUserValidation, UpdateUserValidation, UserListValidation } from '@/validations/UserValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, Put, QueryParams, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';
@Service()
@Authorized('admin')
@JsonController('/users')
export class UserController {
  constructor(private userService: UserService) {}

  @Get('/list')
  @UseBefore(zodValidationMiddleware(UserListValidation))
  async list(@QueryParams() query: any, @CurrentUser({ required: true }) user: { userId: number; email: string; role: string }) {
    return this.userService.list(query, user.userId);
  }

  @Get('/details/:id')
  async details(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number; email: string; role: string }) {
    return this.userService.details(id, user.userId);
  }

  @Post('/create')
  @UseBefore(zodValidationMiddleware(CreateUserValidation))
  async create(@Body() request: z.infer<typeof CreateUserValidation>, @CurrentUser({ required: true }) user: { userId: number; email: string; role: string }) {
    return this.userService.create(request, user.userId);
  }

  @Put('/update/:id')
  @UseBefore(zodValidationMiddleware(UpdateUserValidation))
  async update(@Param('id') id: number, @Body() data: z.infer<typeof UpdateUserValidation>, @CurrentUser({ required: true }) user: { userId: number; email: string; role: string }) {
    return this.userService.update(id, data, user.userId);
  }

  @Delete('/delete/:id')
  async delete(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number; email: string; role: string }) {
    return this.userService.delete(id, user.userId);
  }
}
