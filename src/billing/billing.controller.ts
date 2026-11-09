import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../schemas/admin.schema';
import { PaymentStatus } from '../schemas/payment-record.schema';
import { BillingService } from './billing.service';
import type { CreatePaymentInput } from './billing.service';

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AdminRole.ADMIN, AdminRole.OWNER)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('summary')
  summary() {
    return this.billingService.getSummary();
  }

  @Get()
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.billingService.findRecent(Number(page) || 1, Number(limit) || 50, search || '', status);
  }

  @Post()
  create(@Body() body: CreatePaymentInput, @Req() request: any) {
    return this.billingService.create(body, {
      id: String(request.user.sub),
      username: String(request.user.username || ''),
    });
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: PaymentStatus }) {
    return this.billingService.updateStatus(id, body.status);
  }
}
