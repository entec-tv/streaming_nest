import { SetMetadata } from '@nestjs/common';
import { AdminRole } from '../schemas/admin.schema';

export const ADMIN_ROLES_KEY = 'admin_roles';
export const Roles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);
