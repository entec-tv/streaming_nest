import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../schemas/audit-log.schema';

export interface AdminAuditEntry {
  actorId: string;
  actorUsername: string;
  actorRole: string;
  method: string;
  path: string;
  resourceId?: string;
  success: boolean;
  statusCode: number;
}

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>) {}

  async write(entry: AdminAuditEntry) {
    await this.auditModel.create(entry);
  }

  async findRecent(page = 1, limit = 50, search = '') {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 50));
    const term = search.trim().slice(0, 100);
    const filter = term
      ? { $or: [
          { actorUsername: { $regex: this.escapeRegex(term), $options: 'i' } },
          { path: { $regex: this.escapeRegex(term), $options: 'i' } },
          { resourceId: { $regex: this.escapeRegex(term), $options: 'i' } },
        ] }
      : {};

    const [logs, total] = await Promise.all([
      this.auditModel.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean().exec(),
      this.auditModel.countDocuments(filter),
    ]);

    return { logs, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
