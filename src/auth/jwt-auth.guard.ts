import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { requireJwtSecret } from './jwt-secret';
import { AuthService } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers['authorization'];

    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('يجب تسجيل الدخول أولاً');
    }

    const token = authorization.split(' ')[1];
    try {
      const payload = this.jwtService.verify(token, {
        secret: requireJwtSecret(this.configService),
      });
      const admin = await this.authService.getCurrentAdmin(String(payload.sub || ''));
      if (!admin) throw new UnauthorizedException('الحساب الإداري غير موجود أو تم تعطيله');
      request.user = { ...payload, ...admin };
      return true;
    } catch {
      throw new UnauthorizedException('الجلسة منتهية أو غير صالحة');
    }
  }
}
