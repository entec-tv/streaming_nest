import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Device, DeviceDocument } from '../schemas/device.schema';

@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
  ) {}

  async findAll(): Promise<Device[]> {
    return this.deviceModel.find().exec();
  }

  async findByMac(macAddress: string): Promise<DeviceDocument | null> {
    const normalized = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    const withColons = normalized.match(/.{1,2}/g)?.join(':') || normalized;
    return this.deviceModel.findOne({ macAddress: { $in: [normalized, withColons] } }).exec();
  }

  async updateLastActive(macAddress: string, timestamp: Date = new Date()): Promise<void> {
    const cleanMac = macAddress.replace(/[^A-F0-9]/gi, '');
    const regexPattern = cleanMac.split('').join('[:\\-]?');
    const robustRegex = new RegExp(`^[^A-F0-9]*${regexPattern}[^A-F0-9]*$`, 'i');

    await this.deviceModel.updateMany(
      { macAddress: { $regex: robustRegex } },
      { $set: { lastActive: timestamp } }
    );
  }

  async register(macAddress: string, deviceKey: string): Promise<Device> {
    const normalized = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    const withColons = normalized.match(/.{1,2}/g)?.join(':') || normalized;
    
    let device = await this.deviceModel.findOne({ macAddress: { $in: [normalized, withColons] } });
    
    if (device) {
      device.deviceKey = deviceKey;
      device.lastActive = new Date();
      return device.save();
    }
    
    const newDevice = new this.deviceModel({
      macAddress: withColons,
      deviceKey,
      lastActive: new Date(),
    });
    return newDevice.save();
  }

  async getPlaylists(macAddress: string, deviceKey: string) {
    const device = await this.findByMac(macAddress);
    if (!device) throw new NotFoundException('الجهاز غير مسجل');
    if (device.deviceKey !== deviceKey) throw new ConflictException('رمز الجهاز غير صحيح');
    return device.customPlaylists || [];
  }

  async updatePlaylists(macAddress: string, deviceKey: string, playlists: { name: string; url: string }[]) {
    const device = await this.findByMac(macAddress);
    if (!device) throw new NotFoundException('الجهاز غير مسجل');
    if (device.deviceKey !== deviceKey) throw new ConflictException('رمز الجهاز غير صحيح');
    
    device.customPlaylists = playlists;
    await device.save();
    return device.customPlaylists;
  }
}
