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
    const device = await this.devicesService.register(macAddress, deviceKey);
    const trialInfo = await this.devicesService.getTrialInfo(macAddress);
    const serverNow = new Date();
    return {
      success: true,
      device: {
        macAddress: device.macAddress,
      },
      serverTime: serverNow.toISOString(),
      trial: trialInfo,
      isTrialActive: trialInfo.isTrialActive,
      isAppActive: trialInfo.isTrialActive,
      isAppLocked: !trialInfo.isTrialActive,
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
    if (trialInfo.isRevoked) {
      return {
        success: true,
        serverTime: serverNow.toISOString(),
        trial: trialInfo,
        hasActiveLicense: false,
        appExpiry: null,
        isAppActive: false,
        isAppLocked: true,
      };
    }
    const customer = await this.customersService.findByMac(normalizedMac);
    let hasActiveLicense = false;
    let appExpiry: string | null = null;
    if (customer && customer.status !== CustomerStatus.BLOCKED && customer.subscriptions) {
      const subs = customer.subscriptions.filter(
        s => (s.macAddress || '').toUpperCase().replace(/[^A-F0-9]/g, '') === normalizedMac
      );
      for (const s of subs) {
        if (s.status !== CustomerStatus.BLOCKED && s.appActive !== false) {
          if (!s.appExpiry || new Date(s.appExpiry).getTime() > serverNow.getTime()) {
            hasActiveLicense = true;
            if (s.appExpiry) {
              if (!appExpiry || new Date(s.appExpiry).getTime() > new Date(appExpiry).getTime()) {
                appExpiry = new Date(s.appExpiry).toISOString();
              }
            }
          }
        }
      }
    }

    const isAppActive = hasActiveLicense || trialInfo.isTrialActive;

    return {
      success: true,
      serverTime: serverNow.toISOString(),
      trial: trialInfo,
      hasActiveLicense,
      appExpiry,
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
    if (trialInfo.isRevoked) {
      return {
        serverTime: serverNow.toISOString(),
        macAddress: normalizedMac,
        trial: trialInfo,
        hasActiveLicense: false,
        appExpiry: null,
        isAppActive: false,
        isAppLocked: true,
      };
    }
    const customer = await this.customersService.findByMac(normalizedMac);

    let hasActiveLicense = false;
    let appExpiry: string | null = null;
    if (customer && customer.status !== CustomerStatus.BLOCKED && customer.subscriptions) {
      const subs = customer.subscriptions.filter(
        s => (s.macAddress || '').toUpperCase().replace(/[^A-F0-9]/g, '') === normalizedMac
      );
      for (const s of subs) {
        if ((!deviceKey || s.deviceKey === deviceKey) && s.status !== CustomerStatus.BLOCKED && s.appActive !== false) {
          if (!s.appExpiry || new Date(s.appExpiry).getTime() > serverNow.getTime()) {
            hasActiveLicense = true;
            if (s.appExpiry) {
              if (!appExpiry || new Date(s.appExpiry).getTime() > new Date(appExpiry).getTime()) {
                appExpiry = new Date(s.appExpiry).toISOString();
              }
            }
          }
        }
      }
    }

    const isAppActive = hasActiveLicense || trialInfo.isTrialActive;

    return {
      serverTime: serverNow.toISOString(),
      macAddress: normalizedMac,
      trial: trialInfo,
      hasActiveLicense,
      appExpiry,
      isAppActive,
      isAppLocked: !isAppActive,
    };
  }

  async auth(macAddress: string, deviceKey: string, clientTime?: string) {
    const serverNow = new Date();
    // Normalize MAC address (uppercase, remove special chars)
    const normalizedMac = macAddress.toUpperCase().replace(/[^A-F0-9]/g, '');
    
    // Ensure device exists
    await this.devicesService.register(normalizedMac, deviceKey);

    const trialInfo = await this.devicesService.getTrialInfo(normalizedMac);
    const customer = await this.customersService.findByMac(normalizedMac);

    if (customer && customer.status === CustomerStatus.BLOCKED) {
      throw new ForbiddenException('حساب العميل محظور. يرجى التواصل مع الإدارة.');
    }

    let hasActiveLicense = false;
    let latestAppExpiry: string | null = null;
    let activeSubscriptions: any[] = [];

    if (customer && customer.subscriptions) {
      const subscriptionsForMac = customer.subscriptions.filter(
        s => (s.macAddress || '').toUpperCase().replace(/[^A-F0-9]/g, '') === normalizedMac
      );

      // Return all active subscriptions that match this MAC address and Device Key
      const validSubs = subscriptionsForMac.filter(s => {
        if (s.deviceKey !== deviceKey) return false;
        if (s.status === CustomerStatus.BLOCKED) return false;
        
        // Check app activation
        if (s.appActive === false) return false;
        if (s.appExpiry && new Date(s.appExpiry).getTime() < serverNow.getTime()) return false;
        
        return true;
      });

      if (validSubs.length > 0) {
        hasActiveLicense = true;
        for (const s of validSubs) {
          if (s.appExpiry) {
            if (!latestAppExpiry || new Date(s.appExpiry).getTime() > new Date(latestAppExpiry).getTime()) {
              latestAppExpiry = new Date(s.appExpiry).toISOString();
            }
          }
        }

        activeSubscriptions = await Promise.all(validSubs.map(async (s) => {
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
      }
    }

    const isAppActive = hasActiveLicense || trialInfo.isTrialActive;

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
    };
  }
}
