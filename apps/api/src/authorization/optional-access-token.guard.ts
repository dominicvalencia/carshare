import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from './access-token.guard';

@Injectable()
export class OptionalAccessTokenGuard implements CanActivate {
  constructor(private readonly accessToken: AccessTokenGuard) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    return request.headers.authorization ? this.accessToken.canActivate(context) : true;
  }
}
