import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { HostsModule } from './hosts/hosts.module';
import { CustomersModule } from './customers/customers.module';
import { ClientModule } from './client/client.module';

import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PlansModule } from './plans/plans.module';
import { DevicesModule } from './devices/devices.module';
import { PortalModule } from './portal/portal.module';
import { AppUpdatesModule } from './app-updates/app-updates.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AdminAuditInterceptor } from './audit/admin-audit.interceptor';
import { BillingModule } from './billing/billing.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI', 'mongodb://localhost:27017/Streaming'),
        dbName: 'Streaming',
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    HostsModule,
    CustomersModule,
    ClientModule,
    PlansModule,
    DevicesModule,
    PortalModule,
    AppUpdatesModule,
    AuditModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AdminAuditInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: AdminAuditInterceptor },
  ],
})
export class AppModule {}
