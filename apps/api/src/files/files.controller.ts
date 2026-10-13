import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  StreamableFile,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import type { RequestPrincipal } from '../security/security-context';
import { UploadFileDto } from './files.dto';
import { FilesService } from './files.service';
import { requestMetadata } from '../auth/auth.controller';

@ApiBearerAuth()
@ApiTags('Files')
@Controller('files')
@UseGuards(AccessTokenGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @ApiConsumes('multipart/form-data')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: UploadFileDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.files.upload(principal.userId, input.classification, file);
  }

  @Delete(':id')
  discard(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.files.discardUnattached(principal.userId, id);
  }

  @Get(':id')
  metadata(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.files.metadata(id, principal);
  }

  @Get(':id/content')
  async content(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    const { asset, stream } = await this.files.content(id, principal, requestMetadata(request));
    return new StreamableFile(stream, {
      disposition: `attachment; filename="${asset.originalName.replaceAll('"', '')}"`,
      type: asset.mimeType,
    });
  }

  @Post(':id/access-grants')
  accessGrant(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.files.accessGrant(id, principal, requestMetadata(request));
  }
}

@ApiTags('Expiring file access')
@Controller('file-access')
export class SignedFileAccessController {
  constructor(private readonly files: FilesService) {}

  @Get(':id')
  async content(
    @Param('id') id: string,
    @Query('grant') grant = '',
    @Res({ passthrough: true }) response: Response,
  ) {
    const { asset, stream } = await this.files.signedContent(id, grant);
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return new StreamableFile(stream, {
      disposition: `inline; filename="${asset.originalName.replaceAll('"', '')}"`,
      type: asset.mimeType,
    });
  }
}
