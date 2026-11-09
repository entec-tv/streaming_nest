import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { APP_UPDATE_PLATFORMS, AppUpdate, AppUpdateDocument, AppUpdatePlatform, AppUpdateHistoryEntry } from '../schemas/app-update.schema';

export type SaveAppUpdateInput = {
  version: string;
  downloadUrl?: string;
  sha256?: string;
};

export type AppUpdateActor = {
  id: string;
  username: string;
  role: 'owner' | 'admin';
};

@Injectable()
export class AppUpdatesService {
  constructor(@InjectModel(AppUpdate.name) private readonly updateModel: Model<AppUpdateDocument>) {}

  async getLatestUpdate(platform: AppUpdatePlatform): Promise<AppUpdate | null> {
    return this.updateModel.findOne({ platform }).select('-history').lean().exec() as Promise<AppUpdate | null>;
  }

  async getAllUpdates(): Promise<AppUpdate[]> {
    return this.updateModel.find().select('-history').lean().exec() as Promise<AppUpdate[]>;
  }

  async getUpdateHistory(platform: string, page = 1, limit = 25) {
    if (!APP_UPDATE_PLATFORMS.includes(platform as AppUpdatePlatform)) {
      throw new BadRequestException('Unsupported update platform.');
    }
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 25)));
    const update = await this.updateModel.findOne({ platform }).select('history').lean().exec() as any;
    const history = ((update?.history || []) as AppUpdateHistoryEntry[])
      .slice()
      .sort((a: any, b: any) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
    const total = history.length;
    const entries = history.slice((safePage - 1) * safeLimit, safePage * safeLimit).map((entry: any) => {
      const { actorId, ...safeEntry } = entry;
      return { ...safeEntry, _id: String(entry._id) };
    });
    return {
      entries,
      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit),
    };
  }

  async saveUpdate(
    platform: AppUpdatePlatform,
    input: SaveAppUpdateInput,
    actor: AppUpdateActor,
    action: 'published' | 'restored' = 'published',
    restoredFromId?: string,
  ): Promise<AppUpdate> {
    const version = input.version?.trim();
    const downloadUrl = input.downloadUrl?.trim() || '';
    const sha256 = input.sha256?.trim().toLowerCase() || '';

    if (!APP_UPDATE_PLATFORMS.includes(platform)) throw new BadRequestException('Unsupported update platform.');

    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new BadRequestException('Version must use major.minor.patch format.');
    }
    if (platform !== 'web' || downloadUrl) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(downloadUrl);
      } catch {
        throw new BadRequestException('A valid HTTPS update URL is required.');
      }
      if (parsedUrl.protocol !== 'https:') {
        throw new BadRequestException('The update must be hosted over HTTPS.');
      }
    }
    if (platform === 'windows' && !/^[a-f\d]{64}$/.test(sha256)) {
      throw new BadRequestException('A valid SHA-256 checksum is required to verify the installer.');
    }
    if (sha256 && !/^[a-f\d]{64}$/.test(sha256)) {
      throw new BadRequestException('The SHA-256 checksum must contain 64 hexadecimal characters.');
    }

    const existing = await this.updateModel.findOne({ platform }).lean().exec() as any;
    if (existing && existing.version === version && existing.downloadUrl === downloadUrl && existing.sha256 === sha256) {
      return this.getLatestUpdate(platform) as Promise<AppUpdate>;
    }

    const historyEntries: Record<string, unknown>[] = [];
    if (existing && !(existing.history || []).length) {
      historyEntries.push({
        version: existing.version,
        downloadUrl: existing.downloadUrl || '',
        sha256: existing.sha256 || '',
        action: 'baseline',
        actorId: 'system',
        actorUsername: 'قبل تفعيل سجل التحديثات',
        actorRole: 'system',
        changedAt: existing.updatedAt || existing.createdAt || new Date(),
      });
    }
    historyEntries.push({
      version,
      downloadUrl,
      sha256,
      action,
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      ...(restoredFromId ? { restoredFromId } : {}),
      changedAt: new Date(),
    });

    return this.updateModel.findOneAndUpdate(
      { platform },
      {
        $set: { platform, version, downloadUrl, sha256 },
        $push: { history: { $each: historyEntries, $slice: -500 } },
      },
      { new: true, upsert: true, runValidators: true },
    ).select('-history').exec();
  }

  async restoreHistory(platform: string, historyId: string, actor: AppUpdateActor): Promise<AppUpdate> {
    if (!APP_UPDATE_PLATFORMS.includes(platform as AppUpdatePlatform)) {
      throw new BadRequestException('Unsupported update platform.');
    }
    const current = await this.updateModel.findOne({ platform }).select('history').lean().exec() as any;
    const entry = current?.history?.find((item: any) => String(item._id) === historyId);
    if (!entry) throw new NotFoundException('Update history entry not found.');
    return this.saveUpdate(
      platform as AppUpdatePlatform,
      { version: entry.version, downloadUrl: entry.downloadUrl, sha256: entry.sha256 },
      actor,
      'restored',
      historyId,
    );
  }
}
