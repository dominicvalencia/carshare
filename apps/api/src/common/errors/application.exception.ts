import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorDetail } from '@carrental/api-contracts';

export class ApplicationException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
    readonly details?: readonly ApiErrorDetail[],
  ) {
    super(message, status);
  }
}
