import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ModerationReportStatus,
  SupportMessageVisibility,
  SupportTicketStatus,
} from '@carrental/database';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal, RequirePermissions } from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import { requestMetadata } from '../auth/auth.controller';
import {
  AddSupportMessageDto,
  CreateSupportTicketDto,
  ResolveModerationReportDto,
  UpdateSupportTicketDto,
} from './support.dto';
import { SupportService } from './support.service';
import { ApplicationException } from '../common/errors/application.exception';

@ApiBearerAuth()
@ApiTags('Support')
@Controller('support/tickets')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}
  @Get() list(@CurrentPrincipal() p: RequestPrincipal) {
    return this.support.listUser(p.userId);
  }
  @Get(':reference') detail(
    @CurrentPrincipal() p: RequestPrincipal,
    @Param('reference') reference: string,
  ) {
    return this.support.detailUser(p.userId, reference);
  }
  @Post() @ApiHeader({ name: 'Idempotency-Key', required: true }) create(
    @CurrentPrincipal() p: RequestPrincipal,
    @Body() input: CreateSupportTicketDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.support.create(p.userId, input as never, key ?? '');
  }
  @Post(':reference/messages') @ApiHeader({ name: 'Idempotency-Key', required: true }) message(
    @CurrentPrincipal() p: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: AddSupportMessageDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.support.addUserMessage(p.userId, reference, input.body, key ?? '');
  }
}

@ApiBearerAuth()
@ApiTags('Admin support')
@Controller('admin/support/tickets')
@RequirePermissions('support.read')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}
  @Get() queue(@Query('status') status?: SupportTicketStatus) {
    return this.support.adminQueue(status);
  }
  @Get(':reference') detail(@Param('reference') reference: string) {
    return this.support.adminDetail(reference);
  }
  @Post(':reference/messages')
  @RequirePermissions('support.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  message(
    @CurrentPrincipal() p: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: AddSupportMessageDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
  ) {
    if (
      input.visibility === SupportMessageVisibility.INTERNAL &&
      !p.permissions.includes('support.internal_notes')
    )
      throw new ApplicationException(
        'PERMISSION_DENIED',
        'Internal-note permission is required.',
        HttpStatus.FORBIDDEN,
      );
    return this.support.adminMessage(
      p.userId,
      reference,
      input.body,
      input.visibility ?? SupportMessageVisibility.USER_VISIBLE,
      key ?? '',
      requestMetadata(request),
    );
  }
  @Patch(':reference') @RequirePermissions('support.manage') update(
    @CurrentPrincipal() p: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: UpdateSupportTicketDto,
    @Req() request: Request,
  ) {
    if (input.assignedToUserId && !p.permissions.includes('support.assign'))
      throw new ApplicationException(
        'PERMISSION_DENIED',
        'Support assignment permission is required.',
        HttpStatus.FORBIDDEN,
      );
    return this.support.update(p.userId, reference, input as never, requestMetadata(request));
  }
}

@ApiBearerAuth()
@ApiTags('Admin moderation')
@Controller('admin/moderation/reports')
@RequirePermissions('moderation.read')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminModerationController {
  constructor(private readonly support: SupportService) {}
  @Get() queue(@Query('status') status?: ModerationReportStatus) {
    return this.support.moderationQueue(status);
  }
  @Get(':id') detail(@Param('id') id: string) {
    return this.support.moderationDetail(id);
  }
  @Post(':id/resolve') @RequirePermissions('moderation.manage') resolve(
    @CurrentPrincipal() p: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ResolveModerationReportDto,
    @Req() request: Request,
  ) {
    return this.support.resolveReport(
      p.userId,
      id,
      input.reason,
      input.outcome ?? 'RESOLVED',
      requestMetadata(request),
    );
  }
}
