import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, AddDeviceToCustomerDto } from './create-customer.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../schemas/admin.schema';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  async findAll(@Req() request: any) {
    const customers = await this.customersService.findAll();
    return request.user?.role === AdminRole.VIEWER ? customers.map((customer) => this.redactSecrets(customer)) : customers;
  }

  @Get('stats')
  getStats() {
    return this.customersService.getStats();
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() request: any) {
    const customer = await this.customersService.findOne(id);
    return request.user?.role === AdminRole.VIEWER ? this.redactSecrets(customer) : customer;
  }

  @Post()
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  create(@Body() body: CreateCustomerDto) {
    return this.customersService.create(body);
  }

  @Put(':id')
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  update(@Param('id') id: string, @Body() body: Partial<CreateCustomerDto>) {
    return this.customersService.update(id, body);
  }



  @Put(':id/block')
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  block(@Param('id') id: string) {
    return this.customersService.block(id);
  }

  @Put(':id/unblock')
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  unblock(@Param('id') id: string) {
    return this.customersService.unblock(id);
  }

  @Delete(':id')
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }

  private redactSecrets(customer: any) {
    return {
      ...customer,
      subscriptions: (customer.subscriptions || []).map(({ password, deviceKey, ...subscription }: any) => subscription),
    };
  }
}
