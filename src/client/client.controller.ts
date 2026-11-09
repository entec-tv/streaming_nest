import { Controller, Post, Body, Sse, Query, Param, UseGuards } from '@nestjs/common';
import { ClientService } from './client.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../schemas/admin.schema';

@Controller('client')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Post('auth')
  auth(@Body() body: { macAddress: string; deviceKey: string; clientTime?: string }) {
    return this.clientService.auth(body.macAddress, body.deviceKey, body.clientTime);
  }

  @Post('ping')
  ping(@Body() body: { macAddress: string; clientTime?: string }) {
    return this.clientService.ping(body.macAddress, body.clientTime);
  }

  @Post('register-device')
  registerDevice(@Body() body: { macAddress: string; deviceKey: string }) {
    return this.clientService.registerDevice(body.macAddress, body.deviceKey);
  }

  @Post('status')
  getStatus(@Body() body: { macAddress: string; deviceKey?: string }) {
    return this.clientService.getStatus(body.macAddress, body.deviceKey);
  }

  @Sse('events')
  sse(@Query('macAddress') macAddress: string) {
    return this.clientService.getDeviceSse(macAddress);
  }

  @Post('devices/:macAddress/refresh')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  triggerRefresh(@Param('macAddress') macAddress: string) {
    this.clientService.triggerDeviceRefresh(macAddress);
    return { success: true };
  }
}
