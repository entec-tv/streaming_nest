import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppUpdatesService } from './app-updates.service';
import type { SaveAppUpdateInput } from './app-updates.service';
import { APP_UPDATE_PLATFORMS, AppUpdatePlatform } from '../schemas/app-update.schema';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../schemas/admin.schema';

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
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  @Put(':platform')
  async saveUpdate(@Param('platform') platform: string, @Body() body: SaveAppUpdateInput) {
    if (!APP_UPDATE_PLATFORMS.includes(platform as AppUpdatePlatform)) return null;
    const update = await this.appUpdatesService.saveUpdate(platform as AppUpdatePlatform, body);
    return { success: true, update };
  }
}
