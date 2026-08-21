import { Global, Module, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { ApiEnvironment } from '@carrental/config';
import { createHttpLoggerOptions } from './http-logger.config';

@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configuration: ConfigService<ApiEnvironment, true>) => {
        const environment: Pick<ApiEnvironment, 'APP_ENV' | 'LOG_LEVEL'> = {
          APP_ENV: configuration.getOrThrow('APP_ENV', { infer: true }),
          LOG_LEVEL: configuration.getOrThrow('LOG_LEVEL', { infer: true }),
        };

        return {
          forRoutes: [{ method: RequestMethod.ALL, path: '{*path}' }],
          pinoHttp: createHttpLoggerOptions(environment),
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
