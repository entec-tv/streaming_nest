import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { HostsService } from './hosts.service';
import { CreateHostDto } from './create-host.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../schemas/admin.schema';

@Controller('hosts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HostsController {
  constructor(private readonly hostsService: HostsService) {}

  @Get()
  findAll() {
    return this.hostsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.hostsService.findOne(id);
  }

  @Post()
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  create(@Body() body: CreateHostDto) {
    return this.hostsService.create(body);
  }

  @Put(':id')
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  update(@Param('id') id: string, @Body() body: Partial<CreateHostDto>) {
    return this.hostsService.update(id, body);
  }

  @Delete(':id')
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  remove(@Param('id') id: string) {
    return this.hostsService.remove(id);
  }
}
