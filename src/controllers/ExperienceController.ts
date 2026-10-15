import { AuthUser } from '@/helpers/ownerAccess';
import { ExperienceService } from '@/services/android/experience/ExperienceService';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Patch, Post, Put } from 'routing-controllers';
import { Service } from 'typedi';

/** Experience memory: what the account's runs learned about sites and apps. */
@Service()
@Authorized()
@JsonController('/android/experience')
export class ExperienceController {
  constructor(private experience: ExperienceService) {}

  @Get('/')
  async overview(@CurrentUser({ required: true }) user: AuthUser) {
    return { data: await this.experience.overview(user.userId) };
  }

  @Put('/settings')
  async settings(@Body() body: { enabled?: boolean; learn?: boolean }, @CurrentUser({ required: true }) user: AuthUser) {
    const input = { enabled: typeof body?.enabled === 'boolean' ? body.enabled : undefined, learn: typeof body?.learn === 'boolean' ? body.learn : undefined };
    return { data: await this.experience.saveSettings(user.userId, input) };
  }

  /** A lesson the user writes: trusted at once. */
  @Post('/lessons')
  async teach(@Body() body: { scope?: string; kind?: string; text?: string }, @CurrentUser({ required: true }) user: AuthUser) {
    return { data: await this.experience.teach(user.userId, body ?? {}) };
  }

  @Patch('/lessons/:id')
  async update(@Param('id') id: number, @Body() body: { scope?: string; kind?: string; text?: string; status?: string; reset_score?: boolean }, @CurrentUser({ required: true }) user: AuthUser) {
    return { data: await this.experience.update(user.userId, Number(id), body ?? {}) };
  }

  @Delete('/lessons/:id')
  async remove(@Param('id') id: number, @CurrentUser({ required: true }) user: AuthUser) {
    return { data: await this.experience.remove(user.userId, Number(id)) };
  }
}
