import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export type PaymentRecordDocument = PaymentRecord & Document;

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
}

export enum PaymentMethod {
  CASH = 'cash',
  BANK_TRANSFER = 'bank_transfer',
  CARD = 'card',
  ONLINE = 'online',
  OTHER = 'other',
}

@Schema({ timestamps: true })
export class PaymentRecord {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId: mongoose.Types.ObjectId;

  @Prop({ required: true, trim: true })
  customerName: string;

  @Prop({ trim: true })
  subscriptionId?: string;

  @Prop({ trim: true })
  subscriptionLabel?: string;

  @Prop({ required: true, min: 1, max: 100000000000 })
  amountMinor: number;

  @Prop({ required: true, match: /^[A-Z]{3}$/ })
  currency: string;

  @Prop({ type: String, enum: PaymentStatus, required: true, index: true })
  status: PaymentStatus;

  @Prop({ type: String, enum: PaymentMethod, required: true })
  method: PaymentMethod;

  @Prop({ trim: true, maxlength: 120 })
  reference?: string;

  @Prop({ trim: true, maxlength: 500 })
  notes?: string;

  @Prop({ required: true })
  createdById: string;

  @Prop({ required: true })
  createdByUsername: string;

  @Prop({ type: Date, default: null })
  paidAt?: Date | null;
}

export const PaymentRecordSchema = SchemaFactory.createForClass(PaymentRecord);
PaymentRecordSchema.index({ createdAt: -1 });
PaymentRecordSchema.index({ currency: 1, status: 1, createdAt: -1 });
