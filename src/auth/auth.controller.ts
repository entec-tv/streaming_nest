import { Controller, Post, Body, Get, Put, Delete, Param, UseGuards, Headers, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { AdminRole } from '../schemas/admin.schema';
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  @Post('setup')
  createAdmin(@Body() body: { username: string; password: string }, @Headers('x-admin-setup-key') setupKey?: string) {
    return this.authService.createInitialAdmin(body.username, body.password, setupKey || '');
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getCurrentAdmin(@Req() request: any) {
    return { _id: request.user.sub, username: request.user.username, role: request.user.role };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.OWNER)
  @Get('admins')
  getAdmins() {
    return this.authService.getAdmins();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.OWNER)
  @Post('admins')
  addAdmin(@Body() body: { username: string; password: string; role?: AdminRole }) {
    return this.authService.createAdmin(body.username, body.password, body.role || AdminRole.ADMIN);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.OWNER)
  @Put('admins/:id')
  updateAdmin(@Param('id') id: string, @Body() body: { username?: string; password?: string; role?: AdminRole }, @Req() request: any) {
    return this.authService.updateAdmin(id, body, String(request.user.sub));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.OWNER)
  @Delete('admins/:id')
  deleteAdmin(@Param('id') id: string, @Req() request: any) {
    return this.authService.deleteAdmin(id, String(request.user.sub));
  }
}
