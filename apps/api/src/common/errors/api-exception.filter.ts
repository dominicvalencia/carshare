import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import {
  CORRELATION_ID_HEADER,
  SystemErrorCode,
  type ApiErrorDetail,
  type ApiErrorResponse,
} from '@carrental/api-contracts';
import { ApplicationException } from './application.exception';

interface HttpErrorBody {
  readonly message?: string | readonly string[];
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(@Inject(PinoLogger) private readonly logger: PinoLogger) {
    this.logger.setContext(ApiExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const error = this.toApiError(exception, status);
    const correlationId = response.getHeader(CORRELATION_ID_HEADER)?.toString();

    if (status >= 500) {
      this.logger.error({ err: exception, correlationId, path: request.path }, error.message);
    } else {
      this.logger.warn({ correlationId, errorCode: error.code, path: request.path }, error.message);
    }

    const body: ApiErrorResponse = { success: false, error };
    response.status(status).json(body);
  }

  private toApiError(
    exception: unknown,
    status: HttpStatus,
  ): { code: string; message: string; details?: readonly ApiErrorDetail[] } {
    if (exception instanceof ApplicationException) {
      return {
        code: exception.code,
        message: exception.message,
        ...(exception.details === undefined ? {} : { details: exception.details }),
      };
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const body: HttpErrorBody = typeof response === 'object' ? (response as HttpErrorBody) : {};
      const messages = Array.isArray(body.message) ? body.message : undefined;
      const message =
        messages?.[0] ??
        (typeof body.message === 'string' ? body.message : exception.message || 'Request failed.');

      return {
        code:
          status === HttpStatus.NOT_FOUND
            ? SystemErrorCode.NOT_FOUND
            : SystemErrorCode.VALIDATION_ERROR,
        message,
        ...(messages === undefined ? {} : { details: messages.map((issue) => ({ issue })) }),
      };
    }

    return {
      code: SystemErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred.',
    };
  }
}
