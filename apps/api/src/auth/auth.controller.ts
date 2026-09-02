import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { ApiEnvironment } from '@carrental/config';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import type { RequestPrincipal } from '../security/security-context';
import {
  EmailDto,
  LoginDto,
  MobileVerificationRequestDto,
  OtpRequestDto,
  OtpVerifyDto,
  PasswordResetDto,
  RefreshDto,
  RegisterDto,
  TokenDto,
} from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  @Post('register')
  register(@Body() input: RegisterDto, @Req() request: Request) {
    return this.auth.register(input, requestMetadata(request));
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() input: LoginDto, @Req() request: Request) {
    return this.auth.login(input, requestMetadata(request));
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body() input: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookieName = this.configuration.getOrThrow('ADMIN_REFRESH_COOKIE_NAME', { infer: true });
    const raw = input.refreshToken ?? request.cookies?.[cookieName];
    const result = await this.auth.refresh(raw ?? '', requestMetadata(request));
    if (!input.refreshToken) {
      this.setAdminCookie(response, result.refreshToken);
      return {
        accessToken: result.accessToken,
        accessTokenExpiresIn: result.accessTokenExpiresIn,
        sessionId: result.sessionId,
        user: result.user,
      };
    }
    return result;
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  @UseGuards(AccessTokenGuard)
  async logout(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(principal.sessionId, requestMetadata(request));
    response.clearCookie(
      this.configuration.getOrThrow('ADMIN_REFRESH_COOKIE_NAME', { infer: true }),
    );
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('email-verification/requests')
  @UseGuards(AccessTokenGuard)
  async requestEmailVerification(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Req() request: Request,
  ) {
    await this.auth.requestEmailVerification(principal.userId, requestMetadata(request));
    return { message: 'If verification is required, instructions have been sent.' };
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('email-verification/confirmations')
  confirmEmail(@Body() input: TokenDto, @Req() request: Request) {
    return this.auth.confirmEmailVerification(input.token, requestMetadata(request));
  }

  @Get('email-verification')
  async confirmEmailLink(
    @Query('token') token: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    try {
      await this.auth.confirmEmailVerification(token ?? '', requestMetadata(request));
      response
        .status(HttpStatus.OK)
        .type('html')
        .send(verificationResultPage('Email verified', 'You can return to the Car Rental app.'));
    } catch {
      response
        .status(HttpStatus.BAD_REQUEST)
        .type('html')
        .send(
          verificationResultPage(
            'Verification link unavailable',
            'This link is invalid or expired. Return to the app to request a new one.',
          ),
        );
    }
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post('password-reset/requests')
  async forgotPassword(@Body() input: EmailDto, @Req() request: Request) {
    await this.auth.requestPasswordReset(input.email, requestMetadata(request));
    return { message: 'If an account exists for this email, reset instructions have been sent.' };
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('password-reset/confirmations')
  resetPassword(@Body() input: PasswordResetDto, @Req() request: Request) {
    return this.auth.resetPassword(input.token, input.newPassword, requestMetadata(request));
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post('otp/requests')
  async requestOtp(@Body() input: OtpRequestDto, @Req() request: Request) {
    const result = await this.auth.requestOtp(input, requestMetadata(request));
    return {
      message: 'If the mobile number is eligible, a code has been sent.',
      challengeId: result.challengeId,
    };
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('mobile-verification/requests')
  @UseGuards(AccessTokenGuard)
  requestMobileVerification(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: MobileVerificationRequestDto,
    @Req() request: Request,
  ) {
    return this.auth.requestMobileVerification(principal.userId, input, requestMetadata(request));
  }

  @HttpCode(HttpStatus.OK)
  @Post('otp/verifications')
  verifyOtp(@Body() input: OtpVerifyDto, @Req() request: Request) {
    return this.auth.verifyOtp(input, requestMetadata(request));
  }

  setAdminCookie(response: Response, token: string): void {
    response.cookie(
      this.configuration.getOrThrow('ADMIN_REFRESH_COOKIE_NAME', { infer: true }),
      token,
      {
        httpOnly: true,
        maxAge:
          this.configuration.getOrThrow('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000,
        sameSite: 'strict',
        secure: this.configuration.getOrThrow('COOKIE_SECURE', { infer: true }),
      },
    );
  }
}

function verificationResultPage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

export function requestMetadata(request: Request) {
  return {
    ...(request.id
      ? { correlationId: request.id.toString() }
      : request.headers['x-correlation-id']
        ? { correlationId: request.headers['x-correlation-id'].toString() }
        : {}),
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
  };
}
