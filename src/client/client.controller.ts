import { Controller, Post, Body, Sse, Query, Param } from '@nestjs/common';
import { ClientService } from './client.service';

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

  @Sse('events')
  sse(@Query('macAddress') macAddress: string) {
    return this.clientService.getDeviceSse(macAddress);
  }

  @Post('devices/:macAddress/refresh')
  triggerRefresh(@Param('macAddress') macAddress: string) {
    this.clientService.triggerDeviceRefresh(macAddress);
    return { success: true };
  }
}
