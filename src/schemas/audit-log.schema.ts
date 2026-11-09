import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({ required: true, index: true })
  actorId: string;

  @Prop({ required: true })
  actorUsername: string;

  @Prop({ required: true })
  actorRole: string;

  @Prop({ required: true })
  method: string;

  @Prop({ required: true })
  path: string;

  @Prop()
  resourceId?: string;

  @Prop({ required: true })
  success: boolean;

  @Prop({ required: true })
  statusCode: number;

  createdAt?: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
