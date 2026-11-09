import { Module } from '@nestjs/common';
import { ClientService } from './client.service';
import { ClientController } from './client.controller';
import { CustomersModule } from '../customers/customers.module';
import { DevicesModule } from '../devices/devices.module';
import { HostsModule } from '../hosts/hosts.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    CustomersModule,
    DevicesModule,
    HostsModule,
    AuthModule,
  ],
  providers: [ClientService],
  controllers: [ClientController],
})
export class ClientModule {}
