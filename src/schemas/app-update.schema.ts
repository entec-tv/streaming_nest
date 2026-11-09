import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppUpdateDocument = HydratedDocument<AppUpdate>;
export const APP_UPDATE_PLATFORMS = ['windows', 'android', 'ios', 'web'] as const;
export type AppUpdatePlatform = typeof APP_UPDATE_PLATFORMS[number];

@Schema()
export class AppUpdateHistoryEntry {
  @Prop({ required: true, match: /^\d+\.\d+\.\d+$/ })
  version: string;

  @Prop({ default: '' })
  downloadUrl: string;

  @Prop({ default: '', match: /^$|^[a-f\d]{64}$/i })
  sha256: string;

  @Prop({ required: true, enum: ['published', 'restored', 'baseline'] })
  action: 'published' | 'restored' | 'baseline';

  @Prop({ required: true })
  actorId: string;

  @Prop({ required: true })
  actorUsername: string;

  @Prop({ required: true, enum: ['owner', 'admin', 'system'] })
  actorRole: 'owner' | 'admin' | 'system';

  @Prop()
  restoredFromId?: string;

  @Prop({ default: Date.now })
  changedAt: Date;
}

export const AppUpdateHistoryEntrySchema = SchemaFactory.createForClass(AppUpdateHistoryEntry);

@Schema({ timestamps: true })
export class AppUpdate {
  @Prop({ type: String, enum: APP_UPDATE_PLATFORMS, required: true, unique: true })
  platform: string;

  @Prop({ required: true, match: /^\d+\.\d+\.\d+$/ })
  version: string;

  @Prop({ default: '' })
  downloadUrl: string;

  @Prop({ default: '', match: /^$|^[a-f\d]{64}$/i })
  sha256: string;

  @Prop({ type: [AppUpdateHistoryEntrySchema], default: [] })
  history: AppUpdateHistoryEntry[];
}

export const AppUpdateSchema = SchemaFactory.createForClass(AppUpdate);
