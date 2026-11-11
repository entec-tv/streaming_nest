import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { CustomerStatus } from '../schemas/customer.schema';
import { Host } from '../schemas/host.schema';
import { JwtService } from '@nestjs/jwt';
import { DevicesService } from '../devices/devices.service';
import { HostsService } from '../hosts/hosts.service';
import { Observable, Subject } from 'rxjs';

@Injectable()
export class ClientService {
  constructor(
    private readonly customersService: CustomersService,
    private readonly devicesService: DevicesService,
    private readonly jwtService: JwtService,
    private readonly hostsService: HostsService,
  ) {}

  private readonly deviceEvents = new Map<string, { subject: Subject<{ data: any }>; listeners: number }>();

  private async getLicenseAccess(macAddress: string, serverNow: Date, deviceKey?: string) {
    const customer = await this.customersService.findByMac(macAddress);
    if (!customer || customer.status === CustomerStatus.BLOCKED) {
      return { customer, subscriptions: [] as any[] };
    }

    const subscriptions = (customer.subscriptions || []).filter((subscription: any) => {
      if ((subscription.macAddress || '').toUpperCase().replace(/[^A-F0-9]/g, '') !== macAddress) return false;
      if (deviceKey !== undefined && subscription.deviceKey !== deviceKey) return false;
      if (subscription.status === CustomerStatus.BLOCKED || subscription.appActive === false) return false;
      if (subscription.appExpiry) {
        const appExpiry = new Date(subscription.appExpiry).getTime();
        if (!Number.isFinite(appExpiry) || appExpiry <= serverNow.getTime()) return false;
      }
      return true;
    });

    return { customer, subscriptions };
  }

  getDeviceSse(macAddress: string) {
    const normalizedMac = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    return new Observable<{ data: any }>((subscriber) => {
      let entry = this.deviceEvents.get(normalizedMac);
      if (!entry) {
        entry = { subject: new Subject<{ data: any }>(), listeners: 0 };
        this.deviceEvents.set(normalizedMac, entry);
      }

      entry.listeners += 1;
      const subscription = entry.subject.subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        entry!.listeners = Math.max(0, entry!.listeners - 1);
        if (entry!.listeners === 0 && this.deviceEvents.get(normalizedMac) === entry) {
          entry!.subject.complete();
          this.deviceEvents.delete(normalizedMac);
        }
      };
    });
  }

  triggerDeviceRefresh(macAddress: string) {
    const normalizedMac = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    const entry = this.deviceEvents.get(normalizedMac);
    if (entry) {
      entry.subject.next({ data: { type: 'REFRESH' } });
    }
  }

  async registerDevice(macAddress: string, deviceKey: string) {
    const serverNow = new Date();
    const normalizedMac = String(macAddress || '').toUpperCase().replace(/[^A-F0-9]/g, '');
    const isDeviceRevoked = await this.devicesService.isRevoked(normalizedMac);
    const { customer, subscriptions } = await this.getLicenseAccess(normalizedMac, serverNow, deviceKey);

    // A paid, active app license takes precedence over the trial/device revocation
    // flag. Do not clear the administrative revocation; simply don't let it block
    // a license that is valid for this exact MAC and device key.
    if (isDeviceRevoked && subscriptions.length === 0) {
      throw new ForbiddenException('تم إيقاف هذا الجهاز من الإدارة');
    }

    const device = isDeviceRevoked ? null : await this.devicesService.register(macAddress, deviceKey);
    const trialInfo = await this.devicesService.getTrialInfo(macAddress);
    const hasActiveLicense = subscriptions.length > 0;
    const isTrialAccessAllowed = customer?.status !== CustomerStatus.BLOCKED && !trialInfo.isRevoked && trialInfo.isTrialActive;
    const isAppActive = hasActiveLicense || isTrialAccessAllowed;

    return {
      success: true,
      device: {
        macAddress: device?.macAddress || normalizedMac,
      },
      serverTime: serverNow.toISOString(),
      trial: trialInfo,
      isTrialActive: trialInfo.isTrialActive,
      hasActiveLicense,
      isAppActive,
      isAppLocked: !isAppActive,
    };
  }

  async ping(macAddress: string, clientTime?: string) {
    if (!macAddress) return { success: false, serverTime: new Date().toISOString() };
    const normalizedMac = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    if (!/^[A-F0-9]{12}$/.test(normalizedMac)) {
      return { success: false, serverTime: new Date().toISOString(), isAppActive: false, isAppLocked: true };
    }
    const serverNow = new Date();
    await this.customersService.updateLastActive(normalizedMac, serverNow);
    await this.devicesService.updateLastActive(normalizedMac, serverNow);

    const trialInfo = await this.devicesService.getTrialInfo(normalizedMac);
    const { customer, subscriptions } = await this.getLicenseAccess(normalizedMac, serverNow);
    const hasActiveLicense = subscriptions.length > 0;
    let appExpiry: string | null = null;
    for (const subscription of subscriptions) {
      if (subscription.appExpiry) {
        const expiry = new Date(subscription.appExpiry).toISOString();
        if (!appExpiry || new Date(expiry).getTime() > new Date(appExpiry).getTime()) appExpiry = expiry;
      }
    }

    const isTrialAccessAllowed = customer?.status !== CustomerStatus.BLOCKED && !trialInfo.isRevoked && trialInfo.isTrialActive;
    const isAppActive = hasActiveLicense || isTrialAccessAllowed;

    return {
      success: true,
      serverTime: serverNow.toISOString(),
      trial: trialInfo,
      hasActiveLicense,
      appExpiry,
      isRevoked: trialInfo.isRevoked,
      isAppActive,
      isAppLocked: !isAppActive,
    };
  }

  async getStatus(macAddress: string, deviceKey?: string) {
    if (!macAddress) {
      return { serverTime: new Date().toISOString(), isAppActive: false, isAppLocked: true };
    }
    const normalizedMac = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    if (!/^[A-F0-9]{12}$/.test(normalizedMac)) {
      return { serverTime: new Date().toISOString(), isAppActive: false, isAppLocked: true };
    }
    const serverNow = new Date();
    const trialInfo = await this.devicesService.getTrialInfo(normalizedMac);
    const { customer, subscriptions } = await this.getLicenseAccess(normalizedMac, serverNow, deviceKey);
    const hasActiveLicense = subscriptions.length > 0;
    let appExpiry: string | null = null;
    for (const subscription of subscriptions) {
      if (subscription.appExpiry) {
        const expiry = new Date(subscription.appExpiry).toISOString();
        if (!appExpiry || new Date(expiry).getTime() > new Date(appExpiry).getTime()) appExpiry = expiry;
      }
    }

    const isTrialAccessAllowed = customer?.status !== CustomerStatus.BLOCKED && !trialInfo.isRevoked && trialInfo.isTrialActive;
    const isAppActive = hasActiveLicense || isTrialAccessAllowed;

    return {
      serverTime: serverNow.toISOString(),
      macAddress: normalizedMac,
      trial: trialInfo,
      hasActiveLicense,
      appExpiry,
      isRevoked: trialInfo.isRevoked,
      isAppActive,
      isAppLocked: !isAppActive,
    };
  }

  async auth(macAddress: string, deviceKey: string, clientTime?: string) {
    const serverNow = new Date();
    // Normalize MAC address (uppercase, remove special chars)
    const normalizedMac = String(macAddress || '').toUpperCase().replace(/[^A-F0-9]/g, '');
    if (!/^[A-F0-9]{12}$/.test(normalizedMac) || !deviceKey) {
      throw new ForbiddenException('بيانات الجهاز غير صحيحة');
    }

    const { customer, subscriptions: validSubs } = await this.getLicenseAccess(normalizedMac, serverNow, deviceKey);
    if (customer && customer.status === CustomerStatus.BLOCKED) {
      throw new ForbiddenException('حساب العميل محظور. يرجى التواصل مع الإدارة.');
    }

    const isDeviceRevoked = await this.devicesService.isRevoked(normalizedMac);
    const hasActiveLicense = validSubs.length > 0;

    // Trial-only access remains blocked for administratively revoked devices.
    // A matching, active paid license is authoritative and permits app access.
    if (isDeviceRevoked && !hasActiveLicense) {
      throw new ForbiddenException('تم إيقاف هذا الجهاز من الإدارة');
    }

    if (!isDeviceRevoked) {
      await this.devicesService.register(normalizedMac, deviceKey);
    }

    const trialInfo = await this.devicesService.getTrialInfo(normalizedMac);
    let latestAppExpiry: string | null = null;
    for (const subscription of validSubs) {
      if (subscription.appExpiry) {
        const expiry = new Date(subscription.appExpiry).toISOString();
        if (!latestAppExpiry || new Date(expiry).getTime() > new Date(latestAppExpiry).getTime()) {
          latestAppExpiry = expiry;
        }
      }
    }

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
            appActive: s.appActive,
            appExpiry: s.appExpiry,
          };
        }));

    const isTrialAccessAllowed = !trialInfo.isRevoked && trialInfo.isTrialActive;
    const isAppActive = hasActiveLicense || isTrialAccessAllowed;

    // Check if trial has expired and no active paid license
    if (!isAppActive) {
      throw new ForbiddenException({
        error: 'trial_expired',
        message: 'انتهت الفترة التجريبية للتطبيق (7 أيام). يرجى شراء ترخيص للاستمرار في استخدام التطبيق.',
        serverTime: serverNow.toISOString(),
        trial: trialInfo,
        hasActiveLicense: false,
        isAppActive: false,
        isAppLocked: true,
      });
    }

    // Update last active timestamp for this device using server clock
    await this.customersService.updateLastActive(normalizedMac, serverNow);
    await this.devicesService.updateLastActive(normalizedMac, serverNow);

    const token = this.jwtService.sign({ 
      sub: customer ? (customer as any)._id?.toString() : normalizedMac, 
      mac: normalizedMac,
      name: customer ? customer.name : `Device ${normalizedMac.slice(-4)}`
    });

    return {
      token,
      customer: {
        name: customer ? customer.name : 'Trial User',
        subscriptions: activeSubscriptions,
      },
      serverTime: serverNow.toISOString(),
      trial: trialInfo,
      hasActiveLicense,
      appExpiry: latestAppExpiry,
      isAppActive: true,
      isAppLocked: false,
      isRevoked: isDeviceRevoked,
    };
  }
}
