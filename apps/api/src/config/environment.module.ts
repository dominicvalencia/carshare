import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseApiEnvironment } from '@carrental/config';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: resolve(__dirname, '../../../../.env'),
      isGlobal: true,
      validate: parseApiEnvironment,
    }),
  ],
  exports: [ConfigModule],
})
export class EnvironmentModule {}
