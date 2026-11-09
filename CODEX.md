# ⚙️ Codex Instructions — Backend Workspace (`c:\streaming-nest`)

This workspace contains the production NestJS backend powering the entire EN-TEC Streaming ecosystem.

---

## 🚀 Infrastructure & Deployment

- **Framework**: NestJS 11 (TypeScript)
- **Database**: MongoDB Atlas (`entec-streaming` cluster) via Mongoose 9
- **Hosting / CI/CD**: Railway Cloud
- **Production Base URL**: `https://streamingnest-production.up.railway.app/api`
- **Deploy Trigger**: Pushing commits to `origin/main` automatically triggers a Railway production deployment.

```powershell
# Development server (Port 3000)
npm run start:dev

# Typecheck verification
npx tsc --noEmit

# Deploy
git add . ; git commit -m "Your feature" ; git push
```

---

## 🧱 Core Modules & Endpoints

### 1. Client Module (`src/client/`)
Handles all communications from the mobile/TV/desktop application.

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/client/register-device` | `POST` | Registers MAC address & device key. Initializes 7-day trial timestamps (`trialStartsAt`, `trialEndsAt`). |
| `/client/auth` | `POST` | Validates device authorization. Evaluates trial validity and active admin subscriptions against the **server's authoritative clock** (`new Date()`). Returns JWT token, customer subscriptions, and trial info. If trial expired and no active subscription, throws `403` with `{ error: 'trial_expired', isAppLocked: true }`. |
| `/client/ping` | `POST` | Heartbeat endpoint. Updates device/customer `lastActive` using server clock, returns server time and trial status. |
| `/client/status` | `POST` | Lightweight check returning `serverTime`, `isTrialActive`, `trialDaysRemaining`, `isAppLocked`. |
| `/client/events` | `GET (SSE)` | Server-Sent Events stream for real-time notification broadcast (`REFRESH`). |
| `/client/devices/:macAddress/refresh` | `POST` | Called by admin panel to push real-time refresh to a specific device. |

---

### 2. Portal Module (`src/portal/`)
Powers the end-user web portal at `https://subscription.entec.store`.

- **Device Login (`POST /portal/login`)**: Validates MAC address and device key.
- **Save Playlists (`POST /portal/playlists`)**:
  - Saves custom M3U playlists to the device document (`Device.customPlaylists`).
  - **Auto-Customer Creation**: If a customer record does not exist for this MAC address, it automatically creates a new `Customer`:
    - `name`: Defaulted to the normalized MAC Address (e.g. `EB:EB:F6:F8:E1:E0`).
    - `status`: `ACTIVE`.
  - **Custom Host Detection**: If the playlist URL uses a domain/host not in the pre-configured database, it resolves or saves it so that the admin dashboard can present it under `آخر: [الدومين]`.

---

### 3. Schemas (`src/schemas/`)
- `Device` (`device.schema.ts`):
  - `macAddress`: Unique string (normalized with colons).
  - `deviceKey`: 6-character code.
  - `customPlaylists`: Array of `{ name, url }`.
  - `trialStartsAt`: Date of first device registration.
  - `trialEndsAt`: Date when 7-day trial ends (`trialStartsAt + 7 days`).
  - `lastActive`: Timestamp updated on ping/auth.
- `Customer` (`customer.schema.ts`):
  - `name`: Customer name (or default MAC address).
  - `status`: `ACTIVE` | `INACTIVE` | `BLOCKED`.
  - `subscriptions`: Array of Xtream subscriptions (`macAddress`, `deviceKey`, `host`, `username`, `password`, `appActive`, `appExpiry`).
- `Host` (`host.schema.ts`): Registered IPTV servers (`name`, `url`).
- `Plan` (`plan.schema.ts`): Store subscription plans.

---

## ⏱️ Server Clock Authority (CRITICAL RULE)

> **Never trust `clientTime` received in request bodies to determine expiration.**
> Always generate timestamps on the server using `const serverNow = new Date();`.
> Compare `serverNow` against:
> - `device.trialEndsAt` for trial validity.
> - `subscription.appExpiry` for paid license validity.
