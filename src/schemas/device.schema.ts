import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export type DeviceDocument = Device & Document;

export enum DeviceStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
}

@Schema({ _id: true })
export class CustomPlaylist {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  url: string;

  @Prop()
  pinHash?: string;
}

export const CustomPlaylistSchema = SchemaFactory.createForClass(CustomPlaylist);

@Schema({ timestamps: true })
export class Device {
  @Prop({ required: true, unique: true })
  macAddress: string;

  @Prop({ required: true })
  deviceKey: string;

  @Prop({ type: String, enum: DeviceStatus, default: DeviceStatus.ACTIVE, index: true })
  status: DeviceStatus;

  @Prop({ type: Date, default: null })
  revokedAt?: Date | null;

  @Prop({ type: String, default: null })
  revokeReason?: string | null;

  @Prop({ type: [CustomPlaylistSchema], default: [] })
  customPlaylists: CustomPlaylist[];

  @Prop({ type: Date, default: Date.now })
  lastActive: Date;

  @Prop({ type: Date, default: Date.now })
  trialStartsAt: Date;

  @Prop({ type: Date })
  trialEndsAt: Date;
}

export const DeviceSchema = SchemaFactory.createForClass(Device);
