import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

const REDACTED_PATHS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
] as const;

export interface LoggerConfiguration {
  readonly level: string;
  readonly service: string;
  readonly environment: string;
}

export function createLoggerOptions(configuration: LoggerConfiguration): LoggerOptions {
  return {
    base: {
      environment: configuration.environment,
      service: configuration.service,
    },
    level: configuration.level,
    messageKey: 'message',
    redact: {
      paths: [...REDACTED_PATHS],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

export function createLogger(
  configuration: LoggerConfiguration,
  destination?: DestinationStream,
): Logger {
  const options = createLoggerOptions(configuration);
  return destination === undefined ? pino(options) : pino(options, destination);
}
