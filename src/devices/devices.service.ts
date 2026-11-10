import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Device, DeviceDocument, DeviceStatus } from '../schemas/device.schema';
import { Customer, CustomerDocument } from '../schemas/customer.schema';

@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
  ) {}

  async findAll(): Promise<any[]> {
    const devices = await this.deviceModel
      .find()
      .select('macAddress status revokedAt revokeReason lastActive trialStartsAt trialEndsAt createdAt customPlaylists')
      .sort({ lastActive: -1 })
      .lean()
      .exec();

    return devices.map(({ customPlaylists, ...device }: any) => ({
      ...device,
      playlistCount: Array.isArray(customPlaylists) ? customPlaylists.length : 0,
    }));
  }

  async searchByMacAddress(macAddress: string): Promise<any | null> {
    const query = String(macAddress || '').trim();
    if (!query) throw new BadRequestException('أدخل عنوان MAC للبحث');
    if (query.length > 512) throw new BadRequestException('عنوان MAC أطول من الحد المسموح');

    const macRegex = this.macAddressRegex(query);
    const selection = 'macAddress status revokedAt revokeReason lastActive trialStartsAt trialEndsAt createdAt customPlaylists';
    let device = await this.deviceModel
      .findOne({ macAddress: query })
      .select(selection)
      .lean()
      .exec();

    if (!device && macRegex) {
      device = await this.deviceModel
        .findOne({ macAddress: { $regex: macRegex } })
        .select(selection)
        .lean()
        .exec();
    }

    if (!device && !macRegex) {
      device = await this.deviceModel
        .findOne({ macAddress: query })
        .collation({ locale: 'en', strength: 2 })
        .select(selection)
        .lean()
        .exec();
    }

    if (!device) return null;
    const { customPlaylists, ...result } = device as any;
    return {
      ...result,
      playlistCount: Array.isArray(customPlaylists) ? customPlaylists.length : 0,
    };
  }

  async findByMac(macAddress: string): Promise<DeviceDocument | null> {
    const regex = this.macAddressRegex(macAddress);
    if (!regex) return null;
    return this.deviceModel.findOne({ macAddress: { $regex: regex } }).exec();
  }

  private normalizeMacAddress(macAddress: string): string {
    return String(macAddress || '').toUpperCase().replace(/[^A-F0-9]/g, '');
  }

  private macAddressRegex(macAddress: string): RegExp | null {
    const normalized = this.normalizeMacAddress(macAddress);
    if (!/^[A-F0-9]{12}$/.test(normalized)) return null;
    return new RegExp(`^${normalized.split('').join('[^A-F0-9]*')}$`, 'i');
  }

  private formatMacAddress(normalized: string): string {
    return normalized.match(/.{2}/g)?.join(':') || normalized;
  }

  async updateDeviceIdentity(currentMac: string, nextMac: string, deviceKey: string): Promise<Device> {
    const key = String(deviceKey || '').trim();
    if (key.length < 6 || key.length > 20) throw new BadRequestException('مفتاح الجهاز يجب أن يتكون من 6 إلى 20 حرفاً');
    const normalizedMac = String(nextMac || '').trim().toUpperCase();
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalizedMac)) {
      throw new BadRequestException('صيغة الماك أدرس غير صحيحة');
    }
    const device = await this.findByMac(currentMac);
    if (!device) return this.register(normalizedMac, key);
    if (device.status === DeviceStatus.REVOKED) {
      throw new ForbiddenException('تم إيقاف هذا الجهاز من الإدارة');
    }
    const existing = await this.findByMac(normalizedMac);
    if (existing && String(existing._id) !== String(device._id)) {
      throw new ConflictException('عنوان MAC مستخدم لجهاز آخر');
    }
    if (existing?.status === DeviceStatus.REVOKED) {
      throw new ForbiddenException('عنوان MAC مرتبط بجهاز موقوف');
    }
    device.macAddress = normalizedMac;
    device.deviceKey = key;
    return device.save();
  }

  async updateLastActive(macAddress: string, timestamp: Date = new Date()): Promise<void> {
    const cleanMac = macAddress.replace(/[^A-F0-9]/gi, '');
    if (!/^[A-F0-9]{12}$/i.test(cleanMac)) return;
    const regexPattern = cleanMac.split('').join('[:\\-]?');
    const robustRegex = new RegExp(`^[^A-F0-9]*${regexPattern}[^A-F0-9]*$`, 'i');

    await this.deviceModel.updateMany(
      { macAddress: { $regex: robustRegex }, status: { $ne: DeviceStatus.REVOKED } },
      { $set: { lastActive: timestamp } }
    );
  }

  async register(macAddress: string, deviceKey: string): Promise<Device> {
    const normalized = this.normalizeMacAddress(macAddress);
    if (!/^[A-F0-9]{12}$/.test(normalized)) {
      throw new BadRequestException('صيغة الماك أدرس غير صحيحة');
    }
    const withColons = this.formatMacAddress(normalized);
    
    let device = await this.findByMac(withColons);
    
    if (device) {
      if (device.status === DeviceStatus.REVOKED) {
        throw new ForbiddenException('تم إيقاف هذا الجهاز من الإدارة');
      }
      device.deviceKey = deviceKey;
      device.lastActive = new Date();
      if (!device.trialStartsAt) {
        device.trialStartsAt = (device as any).createdAt || new Date();
      }
      if (!device.trialEndsAt) {
        device.trialEndsAt = new Date(new Date(device.trialStartsAt).getTime() + 7 * 24 * 60 * 60 * 1000);
      }
      return device.save();
    }
    
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const newDevice = new this.deviceModel({
      macAddress: withColons,
      deviceKey,
      status: DeviceStatus.ACTIVE,
      lastActive: now,
      trialStartsAt: now,
      trialEndsAt,
    });
    return newDevice.save();
  }

  async getTrialInfo(macAddress: string) {
    const serverNow = new Date();
    let device = await this.findByMac(macAddress);

    if (device?.status === DeviceStatus.REVOKED) {
      const trialStartsAt = device.trialStartsAt || (device as any).createdAt || serverNow;
      const trialEndsAt = device.trialEndsAt || trialStartsAt;
      return {
        serverTime: serverNow.toISOString(),
        trialStartsAt: new Date(trialStartsAt).toISOString(),
        trialEndsAt: new Date(trialEndsAt).toISOString(),
        isTrialActive: false,
        isRevoked: true,
        daysRemaining: 0,
        hoursRemaining: 0,
      };
    }
    
    if (!device) {
      // If not registered yet, default 7 days from now
      const trialEndsAt = new Date(serverNow.getTime() + 7 * 24 * 60 * 60 * 1000);
      return {
        serverTime: serverNow.toISOString(),
        trialStartsAt: serverNow.toISOString(),
        trialEndsAt: trialEndsAt.toISOString(),
        isTrialActive: true,
        isRevoked: false,
        daysRemaining: 7,
        hoursRemaining: 168,
      };
    }

    if (!device.trialStartsAt) {
      device.trialStartsAt = (device as any).createdAt || serverNow;
    }
    if (!device.trialEndsAt) {
      device.trialEndsAt = new Date(new Date(device.trialStartsAt).getTime() + 7 * 24 * 60 * 60 * 1000);
      await device.save();
    }

    const trialEndsAt = new Date(device.trialEndsAt);
    const isTrialActive = serverNow.getTime() < trialEndsAt.getTime();
    const diffMs = trialEndsAt.getTime() - serverNow.getTime();
    const daysRemaining = isTrialActive ? Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24))) : 0;
    const hoursRemaining = isTrialActive ? Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60))) : 0;

    return {
      serverTime: serverNow.toISOString(),
      trialStartsAt: new Date(device.trialStartsAt).toISOString(),
      trialEndsAt: trialEndsAt.toISOString(),
      isTrialActive,
      isRevoked: false,
      daysRemaining,
      hoursRemaining,
    };
  }

  async getPlaylists(macAddress: string, deviceKey: string) {
    const device = await this.findByMac(macAddress);
    if (!device) throw new NotFoundException('الجهاز غير مسجل');
    if (device.status === DeviceStatus.REVOKED) throw new ForbiddenException('تم إيقاف هذا الجهاز من الإدارة');
    if (device.deviceKey !== deviceKey) throw new ConflictException('رمز الجهاز غير صحيح');
    return device.customPlaylists || [];
  }

  async isRevoked(macAddress: string): Promise<boolean> {
    const device = await this.findByMac(macAddress);
    return device?.status === DeviceStatus.REVOKED;
  }

  async updatePlaylists(macAddress: string, deviceKey: string, playlists: { name: string; url: string }[]) {
    const device = await this.findByMac(macAddress);
    if (!device) throw new NotFoundException('الجهاز غير مسجل');
    if (device.status === DeviceStatus.REVOKED) throw new ForbiddenException('تم إيقاف هذا الجهاز من الإدارة');
    if (device.deviceKey !== deviceKey) throw new ConflictException('رمز الجهاز غير صحيح');
    
    device.customPlaylists = playlists;
    await device.save();
    return device.customPlaylists;
  }

  async revoke(macAddress: string, suppliedDeviceKey?: string) {
    const lookup = String(macAddress || '').trim();
    if (!lookup || lookup.length > 512) throw new BadRequestException('عنوان MAC غير صحيح');
    const normalized = this.normalizeMacAddress(lookup);
    const regex = this.macAddressRegex(lookup);
    const deviceFilter = regex ? { macAddress: { $regex: regex } } : { macAddress: lookup };
    const subscriptionFilter = regex
      ? { 'subscriptions.macAddress': { $regex: regex } }
      : { 'subscriptions.macAddress': lookup };

    let device = await this.deviceModel.findOne(deviceFilter).exec();
    const customer = await this.customerModel
      .findOne(subscriptionFilter)
      .select('subscriptions.macAddress subscriptions.deviceKey')
      .exec();
    const matchingSubscription = customer?.subscriptions?.find(
      (subscription: any) => regex
        ? this.normalizeMacAddress(subscription.macAddress) === normalized
        : subscription.macAddress === lookup,
    ) as any;
    const deviceKey = device?.deviceKey || String(suppliedDeviceKey || '').trim() || matchingSubscription?.deviceKey;

    if (!device && !deviceKey) {
      throw new NotFoundException('الجهاز غير موجود');
    }

    if (!device) {
      const now = new Date();
      device = new this.deviceModel({
        macAddress: regex ? this.formatMacAddress(normalized) : lookup,
        deviceKey,
        status: DeviceStatus.REVOKED,
        revokedAt: now,
        revokeReason: 'admin',
        trialStartsAt: now,
        trialEndsAt: now,
      });
    } else {
      device.status = DeviceStatus.REVOKED;
      device.revokedAt = new Date();
      device.revokeReason = 'admin';
    }

    await device.save();
    const cleanup = await this.customerModel.updateMany(
      subscriptionFilter,
      { $pull: { subscriptions: regex ? { macAddress: { $regex: regex } } : { macAddress: lookup } } },
    ).exec();

    return {
      success: true,
      macAddress: device.macAddress,
      status: device.status,
      removedSubscriptions: cleanup.modifiedCount,
    };
  }

  async restore(macAddress: string) {
    const lookup = String(macAddress || '').trim();
    if (!lookup || lookup.length > 512) throw new BadRequestException('عنوان MAC غير صحيح');
    const regex = this.macAddressRegex(lookup);
    const device = regex
      ? await this.deviceModel.findOne({ macAddress: { $regex: regex } }).exec()
      : await this.deviceModel.findOne({ macAddress: lookup }).collation({ locale: 'en', strength: 2 }).exec();
    if (!device) throw new NotFoundException('الجهاز غير موجود');
    device.status = DeviceStatus.ACTIVE;
    device.revokedAt = null;
    device.revokeReason = null;
    await device.save();
    return { success: true, device };
  }
}
