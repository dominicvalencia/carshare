import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { RequireOwnerPermission } from '../owner-access/owner-access.decorator';
import { OwnerAccessGuard } from '../owner-access/owner-access.guard';
import type { RequestPrincipal } from '../security/security-context';
import { CommunicationsService } from './communications.service';
import { CursorQueryDto, MarkConversationReadDto, SendMessageDto } from './communications.dto';

@Controller('owner/workspaces/:ownerProfileId/conversations')
@UseGuards(AccessTokenGuard, OwnerAccessGuard)
export class OwnerWorkspaceCommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get()
  @RequireOwnerPermission('messages.view')
  list(@CurrentPrincipal() principal: RequestPrincipal, @Query() query: CursorQueryDto) {
    return this.communications.listForOwnerAccess(principal.ownerAccess!, query);
  }

  @Get(':id/context')
  @RequireOwnerPermission('messages.view')
  context(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.communications.contextForOwnerAccess(principal.ownerAccess!, id);
  }

  @Get(':id')
  @RequireOwnerPermission('messages.view')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.communications.detailForOwnerAccess(principal.ownerAccess!, id);
  }

  @Get(':id/messages')
  @RequireOwnerPermission('messages.view')
  messages(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.communications.messagesForOwnerAccess(principal.ownerAccess!, id, query);
  }

  @Post(':id/messages')
  @RequireOwnerPermission('messages.reply')
  send(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: SendMessageDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    return this.communications.sendForOwnerAccess({
      actorUserId: principal.userId,
      body: input.body,
      context: principal.ownerAccess!,
      conversationId: id,
      idempotencyKey: idempotencyKey ?? '',
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      request: requestMetadata(request),
    });
  }

  @Post(':id/read')
  @RequireOwnerPermission('messages.view')
  markRead(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: MarkConversationReadDto,
  ) {
    return this.communications.markReadForOwnerAccess(principal.ownerAccess!, id, input.messageId);
  }
}
