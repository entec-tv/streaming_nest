import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { CustomerStatus } from '../schemas/customer.schema';
import { Host } from '../schemas/host.schema';
import { JwtService } from '@nestjs/jwt';
import { DevicesService } from '../devices/devices.service';
import { HostsService } from '../hosts/hosts.service';
import { Observable, Subject } from 'rxjs';

interface PlaylistAccessCheck {
  isActive: boolean;
  expiresAt: string | null;
  checkedAt: number;
  retryAfter: number;
  unavailable?: boolean;
}

const PLAYLIST_ACCESS_CACHE_TTL_MS = 15 * 60 * 1000;
const PLAYLIST_ACCESS_RETRY_MS = 5 * 60 * 1000;

@Injectable()
export class ClientService {
  constructor(
    private readonly customersService: CustomersService,
    private readonly devicesService: DevicesService,
    private readonly jwtService: JwtService,
    private readonly hostsService: HostsService,
  ) {}

  private readonly deviceEvents = new Map<string, { subject: Subject<{ data: any }>; listeners: number }>();
  private readonly playlistAccessCache = new Map<string, PlaylistAccessCheck>();
  private readonly playlistAccessRequests = new Map<string, Promise<PlaylistAccessCheck>>();

  private async getMatchingSubscriptions(macAddress: string, deviceKey?: string) {
    const customer = await this.customersService.findByMac(macAddress);
    if (!customer || customer.status === CustomerStatus.BLOCKED) {
      return { customer, subscriptions: [] as any[] };
    }

    const subscriptions = (customer.subscriptions || []).filter((subscription: any) => {
      if ((subscription.macAddress || '').toUpperCase().replace(/[^A-F0-9]/g, '') !== macAddress) return false;
      if (deviceKey !== undefined && subscription.deviceKey !== deviceKey) return false;
      return true;
    });

    return { customer, subscriptions };
  }

  private async resolveSubscriptionHost(subscription: any): Promise<string> {
    const host = subscription?.host;
    if (typeof host === 'string' && /^[a-f\d]{24}$/i.test(host)) {
      try {
        return (await this.hostsService.findOne(host))?.url || '';
      } catch {
        return '';
      }
    }
    if (host && typeof host === 'object') {
      if ('url' in host) return String(host.url || '');
      try {
        return (await this.hostsService.findOne(host.toString()))?.url || '';
      } catch {
        return '';
      }
    }
    return typeof host === 'string' ? host : '';
  }

  private parsePlaylistExpiry(rawExpiry: unknown): { expiresAt: string | null; invalid: boolean } {
    const value = String(rawExpiry ?? '').trim();
    if (!value || value.toLowerCase() === 'null' || value === '0') return { expiresAt: null, invalid: false };

    const numeric = /^\d+$/.test(value) ? Number(value) : NaN;
    const timestamp = Number.isFinite(numeric)
      ? numeric * 1000
      : Date.parse(value);
    if (!Number.isFinite(timestamp)) return { expiresAt: null, invalid: true };
    return { expiresAt: new Date(timestamp).toISOString(), invalid: false };
  }

  private effectivePlaylistCheck(check: PlaylistAccessCheck, nowMs: number): PlaylistAccessCheck {
    if (check.expiresAt && Date.parse(check.expiresAt) <= nowMs) {
      return { ...check, isActive: false, unavailable: false };
    }
    return check;
  }

  private cachePlaylistCheck(key: string, check: PlaylistAccessCheck) {
    if (!this.playlistAccessCache.has(key) && this.playlistAccessCache.size >= 2000) {
      const oldestKeys = Array.from(this.playlistAccessCache.keys()).slice(0, 400);
      oldestKeys.forEach((oldestKey) => this.playlistAccessCache.delete(oldestKey));
    }
    this.playlistAccessCache.delete(key);
    this.playlistAccessCache.set(key, check);
  }

  private async verifyPlaylistSubscription(subscription: any, macAddress: string, serverNow: Date): Promise<PlaylistAccessCheck> {
    const identity = String(subscription?._id || `${subscription?.username || ''}:${subscription?.playlistName || ''}`);
    const cacheKey = `${macAddress}:${identity}`;
    const nowMs = serverNow.getTime();
    const cached = this.playlistAccessCache.get(cacheKey);
    if (cached && nowMs < cached.retryAfter) {
      return this.effectivePlaylistCheck(cached, nowMs);
    }

    const running = this.playlistAccessRequests.get(cacheKey);
    if (running) return this.effectivePlaylistCheck(await running, nowMs);

    const request = (async (): Promise<PlaylistAccessCheck> => {
      const host = (await this.resolveSubscriptionHost(subscription)).replace(/\/+$/, '');
      const username = String(subscription?.username || '').trim();
      const password = String(subscription?.password || '');
      if (!/^https?:\/\//i.test(host) || !username || !password) {
        return {
          isActive: false,
          expiresAt: cached?.expiresAt || null,
          checkedAt: nowMs,
          retryAfter: nowMs + PLAYLIST_ACCESS_RETRY_MS,
          unavailable: true,
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      try {
        const endpoint = new URL(`${host}/player_api.php`);
        endpoint.searchParams.set('username', username);
        endpoint.searchParams.set('password', password);
        const response = await fetch(endpoint, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as any;
        const userInfo = payload?.user_info;
        if (!userInfo) {
          return {
            ...(cached || { isActive: true, expiresAt: null, checkedAt: nowMs }),
            retryAfter: nowMs + PLAYLIST_ACCESS_RETRY_MS,
            unavailable: true,
          };
        }
        if (Number(userInfo.auth) === 0) {
          return { isActive: false, expiresAt: null, checkedAt: nowMs, retryAfter: nowMs + PLAYLIST_ACCESS_CACHE_TTL_MS };
        }

        const { expiresAt, invalid } = this.parsePlaylistExpiry(userInfo.exp_date);
        const statusActive = String(userInfo.status || '').toLowerCase() === 'active';
        const isActive = statusActive && !invalid && (!expiresAt || Date.parse(expiresAt) > nowMs);
        return { isActive, expiresAt, checkedAt: nowMs, retryAfter: nowMs + PLAYLIST_ACCESS_CACHE_TTL_MS };
      } catch {
        return {
          // Keep the last confirmed provider state during an outage. With no
          // prior result, an outage alone is not proof that access expired.
          ...(cached || { isActive: true, expiresAt: null, checkedAt: nowMs }),
          retryAfter: nowMs + PLAYLIST_ACCESS_RETRY_MS,
          unavailable: true,
        };
      } finally {
        clearTimeout(timeout);
      }
    })();

    this.playlistAccessRequests.set(cacheKey, request);
    try {
      const result = await request;
      this.cachePlaylistCheck(cacheKey, result);
      return this.effectivePlaylistCheck(result, nowMs);
    } finally {
      this.playlistAccessRequests.delete(cacheKey);
    }
  }

  private async evaluateAccess(macAddress: string, serverNow: Date, deviceKey?: string) {
    const [trial, match] = await Promise.all([
      this.devicesService.getTrialInfo(macAddress),
      this.getMatchingSubscriptions(macAddress, deviceKey),
    ]);
    const { customer, subscriptions: matchingSubscriptions } = match;
    const customerBlocked = customer?.status === CustomerStatus.BLOCKED;
    const administratorBlocked = Boolean(customerBlocked || trial.isRevoked);

    if (administratorBlocked) {
      return {
        customer,
        trial,
        matchingSubscriptions,
        activeSubscriptions: [] as any[],
        hasActiveLicense: false,
        appExpiry: null as string | null,
        playlistExpiry: null as string | null,
        isAppActive: false,
        isAppLocked: true,
        reason: customerBlocked ? 'admin_blocked' : 'device_blocked',
      };
    }

    const appEnabledSubscriptions = matchingSubscriptions.filter((subscription: any) =>
      subscription.status !== CustomerStatus.BLOCKED && subscription.appActive !== false,
    );
    const appActiveSubscriptions = appEnabledSubscriptions.filter((subscription: any) => {
      if (!subscription.appExpiry) return true;
      const expiresAt = new Date(subscription.appExpiry).getTime();
      return Number.isFinite(expiresAt) && expiresAt > serverNow.getTime();
    });
    const playlistChecks = await Promise.all(appActiveSubscriptions.map((subscription: any) =>
      this.verifyPlaylistSubscription(subscription, macAddress, serverNow),
    ));
    const activeSubscriptions = appActiveSubscriptions.filter((_, index) => playlistChecks[index].isActive);
    const hasActiveLicense = activeSubscriptions.length > 0;
    const trialAccessAllowed = matchingSubscriptions.length === 0 && trial.isTrialActive;
    const isAppActive = hasActiveLicense || trialAccessAllowed;
    const appExpiryValues = activeSubscriptions
      .map((subscription: any) => subscription.appExpiry ? new Date(subscription.appExpiry).toISOString() : null)
      .filter((value): value is string => Boolean(value));
    const playlistExpiryValues = playlistChecks
      .map((check) => check.expiresAt)
      .filter((value): value is string => Boolean(value));

    let reason: string | null = null;
    if (!isAppActive) {
      if (matchingSubscriptions.length === 0) reason = 'trial_expired';
      else if (appEnabledSubscriptions.length === 0) reason = 'app_disabled';
      else if (appActiveSubscriptions.length === 0) reason = 'app_subscription_expired';
      else if (playlistChecks.some((check) => check.unavailable)) reason = 'playlist_unavailable';
      else reason = 'playlist_subscription_expired';
    }

    return {
      customer,
      trial,
      matchingSubscriptions,
      activeSubscriptions,
      hasActiveLicense,
      appExpiry: appExpiryValues.length ? appExpiryValues.sort().at(-1)! : null,
      playlistExpiry: playlistExpiryValues.length ? playlistExpiryValues.sort().at(-1)! : null,
      isAppActive,
      isAppLocked: !isAppActive,
      reason,
    };
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
    const device = await this.devicesService.register(macAddress, deviceKey);
    const access = await this.evaluateAccess(normalizedMac, serverNow, deviceKey);

    return {
      success: true,
      device: { macAddress: device.macAddress },
      serverTime: serverNow.toISOString(),
      trial: access.trial,
      isTrialActive: access.trial.isTrialActive,
      hasActiveLicense: access.hasActiveLicense,
      isAppActive: access.isAppActive,
      isAppLocked: access.isAppLocked,
      reason: access.reason,
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

    const device = await this.devicesService.findByMac(normalizedMac);
    const access = await this.evaluateAccess(normalizedMac, serverNow, device?.deviceKey);

    return {
      success: true,
      serverTime: serverNow.toISOString(),
      trial: access.trial,
      hasActiveLicense: access.hasActiveLicense,
      appExpiry: access.appExpiry,
      playlistExpiry: access.playlistExpiry,
      isRevoked: access.trial.isRevoked,
      isAppActive: access.isAppActive,
      isAppLocked: access.isAppLocked,
      reason: access.reason,
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
    const device = deviceKey ? null : await this.devicesService.findByMac(normalizedMac);
    const access = await this.evaluateAccess(normalizedMac, serverNow, deviceKey || device?.deviceKey);

    return {
      serverTime: serverNow.toISOString(),
      macAddress: normalizedMac,
      trial: access.trial,
      hasActiveLicense: access.hasActiveLicense,
      appExpiry: access.appExpiry,
      playlistExpiry: access.playlistExpiry,
      isRevoked: access.trial.isRevoked,
      isAppActive: access.isAppActive,
      isAppLocked: access.isAppLocked,
      reason: access.reason,
    };
  }

  async auth(macAddress: string, deviceKey: string, clientTime?: string) {
    const serverNow = new Date();
    // Normalize MAC address (uppercase, remove special chars)
    const normalizedMac = String(macAddress || '').toUpperCase().replace(/[^A-F0-9]/g, '');
    if (!/^[A-F0-9]{12}$/.test(normalizedMac) || !deviceKey) {
      throw new ForbiddenException('بيانات الجهاز غير صحيحة');
    }

    await this.devicesService.register(normalizedMac, deviceKey);
    const access = await this.evaluateAccess(normalizedMac, serverNow, deviceKey);

    if (!access.isAppActive) {
      const error = access.reason || 'subscription_expired';
      const messages: Record<string, string> = {
        admin_blocked: 'تم إيقاف التطبيق من الإدارة. يرجى التواصل مع الإدارة.',
        device_blocked: 'تم إيقاف هذا الجهاز من الإدارة.',
        app_disabled: 'تفعيل التطبيق معطّل من الإدارة.',
        app_subscription_expired: 'انتهت صلاحية اشتراك التطبيق.',
        playlist_subscription_expired: 'انتهت صلاحية اشتراك قائمة التشغيل.',
        playlist_unavailable: 'تعذّر التحقق من صلاحية قائمة التشغيل الآن.',
        trial_expired: 'انتهت الفترة التجريبية للتطبيق.',
      };
      throw new ForbiddenException({
        error,
        message: messages[error] || messages.trial_expired,
        serverTime: serverNow.toISOString(),
        trial: access.trial,
        hasActiveLicense: access.hasActiveLicense,
        isAppActive: false,
        isAppLocked: true,
      });
    }

    const activeSubscriptions = await Promise.all(access.activeSubscriptions.map(async (s) => {
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

    const customer = access.customer;

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
      trial: access.trial,
      hasActiveLicense: access.hasActiveLicense,
      appExpiry: access.appExpiry,
      playlistExpiry: access.playlistExpiry,
      isAppActive: true,
      isAppLocked: false,
      isRevoked: access.trial.isRevoked,
    };
  }
}
