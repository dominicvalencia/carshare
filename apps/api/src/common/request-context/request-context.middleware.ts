import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '@carrental/api-contracts';
import { RequestContextService } from './request-context.service';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const correlationId =
      request.id?.toString() ??
      response.getHeader(CORRELATION_ID_HEADER)?.toString() ??
      randomUUID();
    request.id = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    this.requestContext.run({ correlationId }, next);
  }
}
