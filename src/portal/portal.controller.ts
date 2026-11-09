import { Controller, Post, Body, Get, Query, Param, UseGuards } from '@nestjs/common';
import { PortalService } from './portal.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../schemas/admin.schema';

@Controller('portal')
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  @Post('login')
  login(@Body() body: { macAddress: string; deviceKey: string }) {
    return this.portalService.login(body.macAddress, body.deviceKey);
  }

  @Get('playlists')
  getPlaylists(
    @Query('macAddress') macAddress: string,
    @Query('deviceKey') deviceKey: string,
  ) {
    return this.portalService.getPlaylists(macAddress, deviceKey);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  @Get('admin/playlists/:macAddress')
  getAdminPlaylists(@Param('macAddress') macAddress: string) {
    return this.portalService.getAdminPlaylists(macAddress);
  }

  @Post('playlists/:id/unlock')
  unlockPlaylist(
    @Param('id') playlistId: string,
    @Body() body: { macAddress: string; deviceKey: string; pin: string },
  ) {
    return this.portalService.unlockPlaylist(body.macAddress, body.deviceKey, playlistId, body.pin);
  }

  @Post('playlists/:id/pin')
  setPlaylistPin(
    @Param('id') playlistId: string,
    @Body() body: { macAddress: string; deviceKey: string; pin: string | null; currentPin?: string },
  ) {
    return this.portalService.setPlaylistPin(body.macAddress, body.deviceKey, playlistId, body.pin, body.currentPin);
  }

  @Post('playlists')
  updatePlaylists(
    @Body() body: { macAddress: string; deviceKey: string; playlists: { name: string; url: string }[] },
  ) {
    return this.portalService.updatePlaylists(body.macAddress, body.deviceKey, body.playlists);
  }

  @Post('subscription/delete/:id')
  deleteSubscription(
    @Param('id') subId: string,
    @Body() body: { macAddress: string; deviceKey: string }
  ) {
    return this.portalService.deleteSubscription(body.macAddress, body.deviceKey, subId);
  }

  @Post('subscription/:id/unlock')
  unlockSubscription(
    @Param('id') subId: string,
    @Body() body: { macAddress: string; deviceKey: string; pin: string },
  ) {
    return this.portalService.unlockSubscription(body.macAddress, body.deviceKey, subId, body.pin);
  }

  @Post('subscription/:id/pin')
  setSubscriptionPin(
    @Param('id') subId: string,
    @Body() body: { macAddress: string; deviceKey: string; pin: string | null; currentPin?: string },
  ) {
    return this.portalService.setSubscriptionPin(body.macAddress, body.deviceKey, subId, body.pin, body.currentPin);
  }

  @Post('subscription/update/:id')
  updateSubscription(
    @Param('id') subId: string,
    @Body() body: { macAddress: string; deviceKey: string; data: any }
  ) {
    return this.portalService.updateSubscription(body.macAddress, body.deviceKey, subId, body.data);
  }

  @Get('hosts')
  getHosts() {
    return this.portalService.getHosts();
  }

  @Post('subscription/add')
  addSubscription(
    @Body() body: { macAddress: string; deviceKey: string; data: any }
  ) {
    return this.portalService.addSubscription(body.macAddress, body.deviceKey, body.data);
  }
}
