import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { PlansService } from './plans.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Plan } from '../schemas/plan.schema';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../schemas/admin.schema';

@Controller()
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get('plans')
  async getPublicPlans() {
    const plans = await this.plansService.findAllActive();
    return { plans };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('admin/plans')
  async getAllPlansAdmin() {
    const plans = await this.plansService.findAllAdmin();
    return { plans };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  @Post('admin/plans')
  async createPlan(@Body() data: Partial<Plan>) {
    const plan = await this.plansService.create(data);
    return { success: true, plan };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  @Put('admin/plans/:id')
  async updatePlan(@Param('id') id: string, @Body() data: Partial<Plan>) {
    const plan = await this.plansService.update(id, data);
    return { success: true, plan };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.ADMIN, AdminRole.OWNER)
  @Delete('admin/plans/:id')
  async deletePlan(@Param('id') id: string) {
    await this.plansService.delete(id);
    return { success: true };
  }
}
