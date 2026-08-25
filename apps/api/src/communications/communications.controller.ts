import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal, RequirePermissions } from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import { requestMetadata } from '../auth/auth.controller';
import { CommunicationsService } from './communications.service';
import {
  CursorQueryDto,
  MarkConversationReadDto,
  ModerateMessageDto,
  ReportContentDto,
  SendMessageDto,
} from './communications.dto';

@ApiBearerAuth()
@ApiTags('Booking conversations')
@Controller('conversations')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class CommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}
  @Get() list(@CurrentPrincipal() principal: RequestPrincipal, @Query() query: CursorQueryDto) {
    return this.communications.list(principal.userId, query);
  }
  @Get(':id') detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.communications.detail(principal.userId, id);
  }
  @Get(':id/messages') messages(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.communications.messages(principal.userId, id, query);
  }
  @Post(':id/messages')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  send(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: SendMessageDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
  ) {
    return this.communications.send(
      principal.userId,
      id,
      input.body,
      input.replyToMessageId,
      key ?? '',
      requestMetadata(request),
    );
  }
  @Post(':id/read') markRead(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: MarkConversationReadDto,
  ) {
    return this.communications.markRead(principal.userId, id, input.messageId);
  }
}

@ApiBearerAuth()
@ApiTags('Trust and safety reports')
@Controller('reports')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class ReportsController {
  constructor(private readonly communications: CommunicationsService) {}
  @Post() create(@CurrentPrincipal() principal: RequestPrincipal, @Body() input: ReportContentDto) {
    return this.communications.report(principal.userId, input);
  }
}

@ApiBearerAuth()
@ApiTags('Admin message moderation')
@Controller('admin/messages')
@RequirePermissions('messages.moderate')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminMessageModerationController {
  constructor(private readonly communications: CommunicationsService) {}
  @Post(':id/moderate') moderate(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ModerateMessageDto,
    @Req() request: Request,
  ) {
    return this.communications.moderateMessage(
      principal.userId,
      id,
      input.reason,
      requestMetadata(request),
    );
  }
}
