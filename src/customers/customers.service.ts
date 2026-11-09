import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Customer, CustomerDocument, CustomerStatus } from '../schemas/customer.schema';
import { CreateCustomerDto, AddDeviceToCustomerDto } from './create-customer.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
  ) {}

  private withPlaylistLockState(customer: any) {
    if (!customer) return customer;
    const data = customer.toObject ? customer.toObject() : customer;
    return {
      ...data,
      subscriptions: (data.subscriptions || []).map((subscription: any) => {
        const { playlistPinHash, ...safe } = subscription;
        return { ...safe, isLocked: Boolean(playlistPinHash) };
      }),
    };
  }

  async findAll(): Promise<Customer[]> {
    const customers = await this.customerModel.find({ phone: { $exists: false } }).select('+subscriptions.playlistPinHash').populate('subscriptions.host').exec();
    return customers.map((customer) => this.withPlaylistLockState(customer)) as any;
  }

  async findOne(id: string): Promise<Customer> {
    const customer = await this.customerModel.findById(id).select('+subscriptions.playlistPinHash').populate('subscriptions.host');
    if (!customer) throw new NotFoundException('العميل غير موجود');
    return this.withPlaylistLockState(customer) as any;
  }

  async findByMac(macAddress: string): Promise<CustomerDocument | null> {
    // macAddress is passed normalized from client.service.ts
    const normalized = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    if (!/^[A-F0-9]{12}$/.test(normalized)) return null;
    
    // Create a robust regex that ignores any non-hex characters between the hex digits
    // e.g. EB:EB... matches EB-EB... matches EBEB...
    const regexPattern = normalized.split('').join('[^A-F0-9]*');
    const robustRegex = new RegExp(`^[^A-F0-9]*${regexPattern}[^A-F0-9]*$`, 'i');

    // Find customer that has a subscription with this MAC address (case insensitive, ignoring formatting)
    return this.customerModel.findOne({ 
      'subscriptions.macAddress': { $regex: robustRegex } 
    }).select('+subscriptions.playlistPinHash').populate('subscriptions.host').exec();
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const subscriptions = await Promise.all((dto.subscriptions || []).map(async (subscription: any) => {
      const { playlistPin, playlistPinHash: _ignoredHash, ...safe } = subscription;
      if (playlistPin !== undefined && playlistPin !== null && playlistPin !== '') {
        if (!/^\d{4,8}$/.test(String(playlistPin))) throw new BadRequestException('يجب أن يتكون PIN من 4 إلى 8 أرقام');
        safe.playlistPinHash = await bcrypt.hash(String(playlistPin), 10);
      }
      return safe;
    }));
    const customer = new this.customerModel({
      name: dto.name,
      subscriptions,
    });
    return customer.save();
  }
  
  async update(id: string, dto: Partial<CreateCustomerDto>): Promise<Customer> {
    const updateData: any = { ...dto };
    if (Array.isArray(updateData.subscriptions)) {
      const existing = await this.customerModel.findById(id).select('+subscriptions.playlistPinHash').exec();
      const previous = (existing?.subscriptions || []) as any[];
      updateData.subscriptions = await Promise.all(updateData.subscriptions.map(async (subscription: any) => {
        const { playlistPin, playlistPinHash: _ignoredHash, ...safe } = subscription;
        const old = safe._id ? previous.find((item) => item._id.toString() === String(safe._id)) : null;
        if (playlistPin !== undefined) {
          if (playlistPin === null || playlistPin === '') return safe;
          if (!/^\d{4,8}$/.test(String(playlistPin))) throw new BadRequestException('يجب أن يتكون PIN من 4 إلى 8 أرقام');
          safe.playlistPinHash = await bcrypt.hash(String(playlistPin), 10);
        } else if (old?.playlistPinHash) {
          safe.playlistPinHash = old.playlistPinHash;
        }
        return safe;
      }));
    }
    const updated = await this.customerModel.findByIdAndUpdate(id, updateData, { new: true }).select('+subscriptions.playlistPinHash').populate('subscriptions.host');
    if (!updated) throw new NotFoundException('العميل غير موجود');
    return this.withPlaylistLockState(updated) as any;
  }

  // Devices are now part of subscriptions, so addDevice/removeDevice are not needed separately.
  // The update() method will handle adding/removing subscriptions.

  async block(id: string): Promise<Customer> {
    const customer = await this.customerModel.findByIdAndUpdate(
      id,
      { status: CustomerStatus.BLOCKED },
      { new: true },
    ).populate('subscriptions.host');
    if (!customer) throw new NotFoundException('العميل غير موجود');
    return customer;
  }

  async unblock(id: string): Promise<Customer> {
    const customer = await this.customerModel.findByIdAndUpdate(
      id,
      { status: CustomerStatus.ACTIVE },
      { new: true },
    ).populate('subscriptions.host');
    if (!customer) throw new NotFoundException('العميل غير موجود');
    return customer;
  }

  async remove(id: string): Promise<{ message: string }> {
    const deleted = await this.customerModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('العميل غير موجود');
    return { message: 'تم حذف العميل بنجاح' };
  }

  async updateLastActive(macAddress: string, timestamp: Date = new Date()): Promise<void> {
    const cleanMac = macAddress.replace(/[^A-F0-9]/gi, '');
    if (!/^[A-F0-9]{12}$/i.test(cleanMac)) return;
    const regexPattern = cleanMac.split('').join('[:\\-]?');
    const robustRegex = new RegExp(`^[^A-F0-9]*${regexPattern}[^A-F0-9]*$`, 'i');

    await this.customerModel.updateMany(
      { 'subscriptions.macAddress': { $regex: robustRegex } },
      { $set: { 'subscriptions.$[elem].lastActive': timestamp } },
      { arrayFilters: [{ 'elem.macAddress': { $regex: robustRegex } }] }
    );
  }

  async getStats() {
    const filter = { phone: { $exists: false } };
    const total = await this.customerModel.countDocuments(filter);
    const active = await this.customerModel.countDocuments({ ...filter, status: CustomerStatus.ACTIVE });
    const blocked = await this.customerModel.countDocuments({ ...filter, status: CustomerStatus.BLOCKED });
    
    // Count total subscriptions across streaming customers only
    const result = await this.customerModel.aggregate([
      { $match: filter },
      { $project: { numberOfDevices: { $size: { $ifNull: ["$subscriptions", []] } } } },
      { $group: { _id: null, totalDevices: { $sum: "$numberOfDevices" } } }
    ]);
    const totalDevices = result.length > 0 ? result[0].totalDevices : 0;

    return { total, active, blocked, totalDevices };
  }
}
