import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CORRELATION_ID_HEADER } from '@carrental/api-contracts';
import { createLoggerOptions } from '@carrental/logger';
import type { ApiEnvironment } from '@carrental/config';
import type { Options } from 'pino-http';

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{8,128}$/;

function requestedCorrelationId(request: IncomingMessage): string | undefined {
  const value = request.headers[CORRELATION_ID_HEADER];
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== undefined && SAFE_CORRELATION_ID.test(candidate) ? candidate : undefined;
}

export function createHttpLoggerOptions(
  environment: Pick<ApiEnvironment, 'APP_ENV' | 'LOG_LEVEL'>,
): Options {
  return {
    ...createLoggerOptions({
      environment: environment.APP_ENV,
      level: environment.LOG_LEVEL,
      service: 'api',
    }),
    autoLogging: true,
    customProps: (request) => ({ correlationId: request.id }),
    genReqId: (request: IncomingMessage, response: ServerResponse) => {
      const correlationId = requestedCorrelationId(request) ?? randomUUID();
      response.setHeader(CORRELATION_ID_HEADER, correlationId);
      return correlationId;
    },
  };
}
