import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppUpdatesService } from './app-updates.service';
import type { SaveAppUpdateInput } from './app-updates.service';
import { APP_UPDATE_PLATFORMS, AppUpdatePlatform } from '../schemas/app-update.schema';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../schemas/admin.schema';
import type { AppUpdateActor } from './app-updates.service';

@Controller('app-updates')
export class AppUpdatesController {
  constructor(private readonly appUpdatesService: AppUpdatesService) {}

  @Get('latest')
  getLatestWindowsUpdate() {
    return this.appUpdatesService.getLatestUpdate('windows');
  }

  @Get('latest/:platform')
  getLatestUpdate(@Param('platform') platform: string) {
    if (!APP_UPDATE_PLATFORMS.includes(platform as AppUpdatePlatform)) return null;
    return this.appUpdatesService.getLatestUpdate(platform as AppUpdatePlatform);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get()
  async getAllUpdates() {
    const updates = await this.appUpdatesService.getAllUpdates();
    return { updates };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':platform/history')
  getUpdateHistory(
    @Param('platform') platform: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.appUpdatesService.getUpdateHistory(platform, Number(page) || 1, Number(limit) || 25);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  @Put(':platform')
  async saveUpdate(@Param('platform') platform: string, @Body() body: SaveAppUpdateInput, @Req() request: any) {
    if (!APP_UPDATE_PLATFORMS.includes(platform as AppUpdatePlatform)) return null;
    const update = await this.appUpdatesService.saveUpdate(platform as AppUpdatePlatform, body, this.getActor(request));
    return { success: true, update };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  @Post(':platform/history/:historyId/restore')
  async restoreHistory(
    @Param('platform') platform: string,
    @Param('historyId') historyId: string,
    @Req() request: any,
  ) {
    const update = await this.appUpdatesService.restoreHistory(platform, historyId, this.getActor(request));
    return { success: true, update };
  }

  private getActor(request: any): AppUpdateActor {
    return {
      id: String(request.user.sub),
      username: String(request.user.username || ''),
      role: request.user.role === AdminRole.OWNER ? 'owner' : 'admin',
    };
  }
}
