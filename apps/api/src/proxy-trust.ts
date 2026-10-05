import type { INestApplication } from '@nestjs/common';
import type { ApiEnvironment } from '@carrental/config';

export type ExpressProxyTrust = 'loopback' | false;

export function proxyTrustForEnvironment(
  appEnvironment: ApiEnvironment['APP_ENV'],
): ExpressProxyTrust {
  return appEnvironment === 'local' ? 'loopback' : false;
}

export function configureProxyTrust(
  app: INestApplication,
  appEnvironment: ApiEnvironment['APP_ENV'],
): void {
  const express = app.getHttpAdapter().getInstance() as {
    set(name: string, value: unknown): void;
  };
  express.set('trust proxy', proxyTrustForEnvironment(appEnvironment));
}
