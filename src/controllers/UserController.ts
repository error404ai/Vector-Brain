import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { UserService } from '@/services/controllerService/UserService';
import { CreateUserValidation, UpdateUserValidation, UserQueryValidation, type CreateUserRequest, type UpdateUserRequest } from '@/validations/UserValidation';
import { Body, Delete, Get, JsonController, Param, Post, Put, QueryParams, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';

@JsonController('/users')
@Service()
export class UserController {
  constructor(private userService: UserService) {}

  @Get('/')
  @UseBefore(zodValidationMiddleware(UserQueryValidation))
  async getAll(@QueryParams() query: any) {
    return this.userService.findAll(query);
  }

  @Get('/:id')
  async getOne(@Param('id') id: number) {
    return this.userService.findOne(id);
  }

  @Post('/')
  @UseBefore(zodValidationMiddleware(CreateUserValidation))
  async create(@Body() data: CreateUserRequest) {
    return this.userService.create(data);
  }

  @Put('/:id')
  @UseBefore(zodValidationMiddleware(UpdateUserValidation))
  async update(@Param('id') id: number, @Body() data: UpdateUserRequest) {
    return this.userService.update(id, data);
  }

  @Delete('/:id')
  async delete(@Param('id') id: number) {
    return this.userService.delete(id);
  }
}
