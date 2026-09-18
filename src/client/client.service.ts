import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { CustomerStatus } from '../schemas/customer.schema';
import { Host } from '../schemas/host.schema';
import { JwtService } from '@nestjs/jwt';
import { DevicesService } from '../devices/devices.service';
import { HostsService } from '../hosts/hosts.service';
import { Subject } from 'rxjs';

@Injectable()
export class ClientService {
  constructor(
    private readonly customersService: CustomersService,
    private readonly devicesService: DevicesService,
    private readonly jwtService: JwtService,
    private readonly hostsService: HostsService,
  ) {}

  private readonly deviceEvents = new Map<string, Subject<{ data: any }>>();

  getDeviceSse(macAddress: string) {
    const normalizedMac = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    if (!this.deviceEvents.has(normalizedMac)) {
      this.deviceEvents.set(normalizedMac, new Subject());
    }
    return this.deviceEvents.get(normalizedMac)!.asObservable();
  }

  triggerDeviceRefresh(macAddress: string) {
    const normalizedMac = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    if (this.deviceEvents.has(normalizedMac)) {
      this.deviceEvents.get(normalizedMac)!.next({ data: { type: 'REFRESH' } });
    }
  }

  async registerDevice(macAddress: string, deviceKey: string) {
    return this.devicesService.register(macAddress, deviceKey);
  }

  async ping(macAddress: string, clientTime?: string) {
    if (!macAddress) return { success: false };
    const normalizedMac = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    const timestamp = clientTime && !isNaN(new Date(clientTime).getTime()) ? new Date(clientTime) : new Date();
    await this.customersService.updateLastActive(normalizedMac, timestamp);
    await this.devicesService.updateLastActive(normalizedMac, timestamp);
    return { success: true, timestamp };
  }

  async auth(macAddress: string, deviceKey: string, clientTime?: string) {
    // Normalize MAC address (uppercase, remove special chars)
    const normalizedMac = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    let customer = await this.customersService.findByMac(normalizedMac);

    if (!customer) {
      // Auto-register logic is removed since devices are now tied to subscriptions which are created by admins.
      throw new NotFoundException('error_device_not_registered');
    }

    // Find the most recent subscription for this device
    const subscriptionsForMac = customer.subscriptions.filter(
      s => s.macAddress.toUpperCase().replace(/[^A-F0-9]/g, '') === normalizedMac
    );
    if (customer.status === CustomerStatus.BLOCKED) {
      throw new ForbiddenException('حساب العميل محظور. يرجى التواصل مع الإدارة.');
    }

    // Return all active subscriptions that match this MAC address and Device Key
    const validSubs = subscriptionsForMac.filter(s => {
      if (s.deviceKey !== deviceKey) return false;
      if (s.status === CustomerStatus.BLOCKED) return false;
      
      // Check app activation
      if (s.appActive === false) return false;
      if (s.appExpiry && new Date(s.appExpiry) < new Date()) return false;
      
      return true;
    });

    const activeSubscriptions = await Promise.all(validSubs.map(async (s) => {
      let hUrl = '';
      let hName = 'Admin Subscription';

      const isObjectIdString = typeof s.host === 'string' && /^[a-f\d]{24}$/i.test(s.host);
      const isObjectIdObject = s.host && typeof s.host === 'object' && !('url' in (s.host as any));

      if (isObjectIdObject || isObjectIdString) {
         try {
            const hostDoc = await this.hostsService.findOne((s.host as any).toString());
            if (hostDoc) {
              hUrl = hostDoc.url;
              hName = hostDoc.name;
            }
         } catch(e) { }
      } else if (s.host && typeof s.host === 'object' && ('url' in (s.host as any))) {
         hUrl = (s.host as any).url;
         hName = (s.host as any).name;
      } else if (typeof s.host === 'string') {
         hUrl = s.host;
      }

      return {
        id: (s as any)._id?.toString() || Math.random().toString(),
        host: hUrl,
        name: hName,
        username: s.username,
        password: s.password,
      };
    }));

    if (activeSubscriptions.length === 0) {
      throw new ForbiddenException('لا يوجد اشتراكات فعالة لهذا الجهاز، أو قد تم حظرها. يرجى التواصل مع الإدارة.');
    }

    // Update last active timestamp for this device
    const timestamp = clientTime && !isNaN(new Date(clientTime).getTime()) ? new Date(clientTime) : new Date();
    await this.customersService.updateLastActive(normalizedMac, timestamp);
    await this.devicesService.updateLastActive(normalizedMac, timestamp);

    const token = this.jwtService.sign({ 
      sub: (customer as any)._id?.toString(), 
      mac: normalizedMac,
      name: customer.name 
    });

    return {
      token,
      customer: {
        name: customer.name,
        subscriptions: activeSubscriptions,
      },
    };
  }
}
