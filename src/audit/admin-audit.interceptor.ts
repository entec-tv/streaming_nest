import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const method = String(request.method || '').toUpperCase();

    if (!user?.sub || !['owner', 'admin', 'viewer'].includes(user.role) || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const path = String(request.originalUrl || request.url || '').split('?')[0].replace(/^\/api(?=\/)/, '');
    const resourceId = Object.values(request.params || {})
      .map((value) => String(value || '').slice(0, 120))
      .find(Boolean);
    const response = context.switchToHttp().getResponse();

    return next.handle().pipe(
      tap({
        next: () => this.record({
          actorId: String(user.sub),
          actorUsername: String(user.username || ''),
          actorRole: String(user.role || 'admin'),
          method,
          path,
          resourceId,
          success: true,
          statusCode: Number(response.statusCode || 200),
        }),
        error: (error) => this.record({
          actorId: String(user.sub),
          actorUsername: String(user.username || ''),
          actorRole: String(user.role || 'admin'),
          method,
          path,
          resourceId,
          success: false,
          statusCode: typeof error?.getStatus === 'function' ? error.getStatus() : 500,
        }),
      }),
    );
  }

  private record(entry: Parameters<AuditService['write']>[0]) {
    void this.auditService.write(entry).catch(() => undefined);
  }
}
