import { AccessControllerHelper } from '@/helpers/AccessControllerHelper';
import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { UserService } from '@/services/controllerService/UserService';
import { CreateUserValidation, UpdateUserValidation, UserListValidation } from '@/validations/UserValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, Put, QueryParams, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';
@Service()
@Authorized()
@JsonController('/users')
export class UserController {
  constructor(private userService: UserService) {}

  @Get('/list')
  @UseBefore(zodValidationMiddleware(UserListValidation))
  async list(@QueryParams() query: any, @CurrentUser({ required: true }) user: { userId: number; email: string }) {
    if (!(await AccessControllerHelper.canViewUser(user.userId))) {
      throw new Error('Unauthorized to view users');
    }
    return this.userService.list(query);
  }

  @Get('/details/:id')
  async details(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number; email: string }) {
    if (!(await AccessControllerHelper.canViewUser(user.userId))) {
      throw new Error('Unauthorized to view user details');
    }
    return this.userService.details(id);
  }

  @Post('/create')
  @UseBefore(zodValidationMiddleware(CreateUserValidation))
  async create(@Body() request: z.infer<typeof CreateUserValidation>, @CurrentUser({ required: true }) user: { userId: number; email: string }) {
    if (!(await AccessControllerHelper.canCreateUser(user.userId))) {
      throw new Error('Unauthorized to create user');
    }
    return this.userService.create(request);
  }

  @Put('/update/:id')
  @UseBefore(zodValidationMiddleware(UpdateUserValidation))
  async update(@Param('id') id: number, @Body() data: z.infer<typeof UpdateUserValidation>, @CurrentUser({ required: true }) user: { userId: number; email: string }) {
    if (!(await AccessControllerHelper.canUpdateUser(user.userId))) {
      throw new Error('Unauthorized to update user');
    }
    return this.userService.update(id, data);
  }

  @Delete('/delete/:id')
  async delete(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number; email: string }) {
    if (!(await AccessControllerHelper.canDeleteUser(user.userId))) {
      throw new Error('Unauthorized to delete user');
    }
    return this.userService.delete(id);
  }
}
