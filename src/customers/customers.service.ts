import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Customer, CustomerDocument, CustomerStatus } from '../schemas/customer.schema';
import { CreateCustomerDto, AddDeviceToCustomerDto } from './create-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
  ) {}

  async findAll(): Promise<Customer[]> {
    return this.customerModel.find().populate('subscriptions.host').exec();
  }

  async findOne(id: string): Promise<Customer> {
    const customer = await this.customerModel.findById(id).populate('subscriptions.host');
    if (!customer) throw new NotFoundException('العميل غير موجود');
    return customer;
  }

  async findByMac(macAddress: string): Promise<CustomerDocument | null> {
    // macAddress is passed normalized from client.service.ts
    const normalized = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    
    // Create a robust regex that ignores any non-hex characters between the hex digits
    // e.g. EB:EB... matches EB-EB... matches EBEB...
    const regexPattern = normalized.split('').join('[^A-F0-9]*');
    const robustRegex = new RegExp(`^[^A-F0-9]*${regexPattern}[^A-F0-9]*$`, 'i');

    // Find customer that has a subscription with this MAC address (case insensitive, ignoring formatting)
    return this.customerModel.findOne({ 
      'subscriptions.macAddress': { $regex: robustRegex } 
    }).populate('subscriptions.host').exec();
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const customer = new this.customerModel({
      name: dto.name,
      subscriptions: dto.subscriptions || [],
    });
    return customer.save();
  }
  
  async update(id: string, dto: Partial<CreateCustomerDto>): Promise<Customer> {
    const updateData: any = { ...dto };
    const updated = await this.customerModel.findByIdAndUpdate(id, updateData, { new: true }).populate('subscriptions.host');
    if (!updated) throw new NotFoundException('العميل غير موجود');
    return updated;
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
    const regexPattern = cleanMac.split('').join('[:\\-]?');
    const robustRegex = new RegExp(`^[^A-F0-9]*${regexPattern}[^A-F0-9]*$`, 'i');

    await this.customerModel.updateMany(
      { 'subscriptions.macAddress': { $regex: robustRegex } },
      { $set: { 'subscriptions.$[elem].lastActive': timestamp } },
      { arrayFilters: [{ 'elem.macAddress': { $regex: robustRegex } }] }
    );
  }

  async getStats() {
    const total = await this.customerModel.countDocuments();
    const active = await this.customerModel.countDocuments({ status: CustomerStatus.ACTIVE });
    const blocked = await this.customerModel.countDocuments({ status: CustomerStatus.BLOCKED });
    
    // Count total subscriptions (which equal total devices now) across all customers
    const result = await this.customerModel.aggregate([
      { $project: { numberOfDevices: { $size: "$subscriptions" } } },
      { $group: { _id: null, totalDevices: { $sum: "$numberOfDevices" } } }
    ]);
    const totalDevices = result.length > 0 ? result[0].totalDevices : 0;

    return { total, active, blocked, totalDevices };
  }
}
