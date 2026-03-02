import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { promises as fs } from 'fs';
import { DocumentService } from './document.service';
import { UploadDocumentDto } from './dto/upload.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { UserId } from '../../common/decorators/user-id.decorator';

@Controller('api/documents')
@UseGuards(AuthGuard)
export class DocumentController {
  constructor(private documentService: DocumentService) {}

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: './uploads',
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
          'text/csv',
          'application/csv',
          'text/plain',
        ];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
        }
      },
    }),
  )
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadDocumentDto,
    @UserId() userId: string,
  ) {
    const embeddingProvider = dto.embeddingProvider || 'openai';
    const embeddingModel = dto.embeddingModel || 'text-embedding-3-small';

    const results: any = [];
    for (const file of files) {
      const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const meta = await this.documentService.uploadDocument(
        file.path,
        fileName,
        file.mimetype,
        file.size,
        {
          embeddingProvider,
          embeddingModel,
          ownerId: userId,
        },
      );
      results.push(meta as any);

      await fs.unlink(file.path).catch(() => {});
    }

    return { documents: results };
  }

  @Get()
  async list(@UserId() userId: string) {
    const docs = await this.documentService.listDocuments(userId);
    return { documents: docs };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.documentService.deleteDocument(id);
    return { success: true };
  }
}
