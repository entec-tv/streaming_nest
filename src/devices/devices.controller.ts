import { Controller, Get, Body, Param, Put, Delete, UseGuards } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../schemas/admin.schema';

@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  findAll() {
    return this.devicesService.findAll();
  }

  @Put(':macAddress/identity')
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  updateDeviceIdentity(@Param('macAddress') macAddress: string, @Body() body: { macAddress: string; deviceKey: string }) {
    return this.devicesService.updateDeviceIdentity(macAddress, body.macAddress, body.deviceKey);
  }

  @Delete(':macAddress')
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  revokeDevice(@Param('macAddress') macAddress: string, @Body() body: { deviceKey?: string }) {
    return this.devicesService.revoke(macAddress, body?.deviceKey);
  }

  @Put(':macAddress/restore')
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  restoreDevice(@Param('macAddress') macAddress: string) {
    return this.devicesService.restore(macAddress);
  }
}
