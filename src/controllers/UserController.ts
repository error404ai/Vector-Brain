import { UserService } from '@/services/controllerService/UserService';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from '@/validations/UserValidation';
import { Body, Delete, Get, JsonController, Param, Post, Put, QueryParams } from 'routing-controllers';
import { Service } from 'typedi';

@JsonController('/users')
@Service()
export class UserController {
  constructor(private userService: UserService) {}

  @Get('/')
  async getAll(@QueryParams() query: UserQueryDto) {
    return this.userService.findAll(query);
  }

  @Get('/:id')
  async getOne(@Param('id') id: number) {
    return this.userService.findOne(id);
  }

  @Post('/')
  async create(@Body() data: CreateUserDto) {
    return this.userService.create(data);
  }

  @Put('/:id')
  async update(@Param('id') id: number, @Body() data: UpdateUserDto) {
    return this.userService.update(id, data);
  }

  @Delete('/:id')
  async delete(@Param('id') id: number) {
    return this.userService.delete(id);
  }
}
