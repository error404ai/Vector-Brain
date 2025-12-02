import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { UserService } from '@/services/controllerService/UserService';
import { CreateUserValidation, UpdateUserValidation, UserListValidation } from '@/validations/UserValidation';
import { Body, Delete, Get, JsonController, Param, Post, Put, QueryParams, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@JsonController('/users')
@Service()
export class UserController {
  constructor(private userService: UserService) {}

  @Get('/list')
  @UseBefore(zodValidationMiddleware(UserListValidation))
  async list(@QueryParams() query: any) {
    return this.userService.list(query);
  }

  @Get('/details/:id')
  async details(@Param('id') id: number) {
    return this.userService.details(id);
  }

  @Post('/create')
  @UseBefore(zodValidationMiddleware(CreateUserValidation))
  async create(@Body() request: z.infer<typeof CreateUserValidation>) {
    return this.userService.create(request);
  }

  @Put('/update/:id')
  @UseBefore(zodValidationMiddleware(UpdateUserValidation))
  async update(@Param('id') id: number, @Body() data: z.infer<typeof UpdateUserValidation>) {
    return this.userService.update(id, data);
  }

  @Delete('/delete/:id')
  async delete(@Param('id') id: number) {
    return this.userService.delete(id);
  }
}
