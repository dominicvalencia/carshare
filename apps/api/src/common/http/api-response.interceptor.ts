import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import type { ApiSuccessResponse } from '@carrental/api-contracts';

@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<unknown> | StreamableFile
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<unknown> | StreamableFile> {
    return next
      .handle()
      .pipe(
        map((data) =>
          data instanceof StreamableFile
            ? data
            : ({ success: true, data: serializeBigInts(data) } as const),
        ),
      );
  }
}

function serializeBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)]),
    );
  }
  return value;
}
