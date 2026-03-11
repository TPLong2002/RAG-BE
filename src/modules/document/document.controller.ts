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
  Query,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { promises as fs } from 'fs';
import { DocumentService } from './document.service';
import { UploadDocumentDto } from './dto/upload.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { UserId } from '../../common/decorators/user-id.decorator';
import { GoogleDriveService } from './google-drive.service';
@Controller('api/documents')
@UseGuards(AuthGuard)
export class DocumentController {
  constructor(
    private documentService: DocumentService,
    private googleDriveService: GoogleDriveService,
  ) {}

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

      const textHash = await this.documentService.calculateTextHash(file.path, file.mimetype);
      if (textHash) {
        const existing = await this.documentService.findByHash(textHash);
        if (existing) {
          await fs.unlink(file.path).catch(() => {});
          results.push({ fileName, isExisting: true });
          continue;
        }
      }

      const meta = await this.documentService.uploadDocument(
        file.path,
        fileName,
        file.mimetype,
        file.size,
        {
          embeddingProvider,
          embeddingModel,
          ownerId: userId,
          hash: textHash,
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

  @Get('drive/auth-url')
  getAuthUrl() {
    return { url: this.googleDriveService.getAuthUrl() };
  }

  // Callback từ Google
  @Get('drive/callback')
  async callback(@Query('code') code: string) {
    await this.googleDriveService.setTokens(code);
    return 'Done! You can close this tab and go back to the app.';
  }

  // List file trong folder
  @Get('drive/files')
  async listDriveFiles(
    @Query('folderId') folderId: string,
    @Query('search') search: string,
  ) {
    const files = await this.googleDriveService.listFiles(folderId, search);
    return { files };
  }

  // Ingest file từ Drive
  @Post('drive/ingest')
  async ingestFromDrive(
    @Body()
    dto: {
      fileId: string;
      embeddingProvider?: string;
      embeddingModel?: string;
    },
    @UserId() userId: string,
  ) {
    // Tạo đường dẫn tạm
    const tempPath = `./uploads/drive_${Date.now()}`;

    try {
      // 1. Tải từ Drive về và tự động chuyển sang PDF bên trong Service
      const fileInfo: any = await this.googleDriveService.downloadFile(
        dto.fileId,
        tempPath,
      );

      // 2. Tính mã Hash của file vừa tải về
      const textHash = await this.documentService.calculateTextHash(
        fileInfo.path,
        fileInfo.mimeType,
      );

      console.log('abcd1', textHash);
      if (!textHash)
        throw new Error('Không thể trích nội dung từ văn bản này.');

      // 3. Kiểm tra trùng lặp trong Neo4j (global, không phân biệt user)
      const existingDoc = await this.documentService.findByHash(textHash);
      console.log('abc', existingDoc);
      if (existingDoc) {
        console.log(
          `♻️ File "${fileInfo.name}" đã tồn tại (Hash: ${textHash}). Dùng lại dữ liệu cũ.`,
        );
        // Xóa file tạm vừa tải về vì không cần dùng nữa
        await fs.unlink(fileInfo.path).catch(() => {});
        // Trả về document cũ đã có trong DB
        return {
          document: {
            fileName: fileInfo.name,
          },
          isExisting: true,
        };

        // return { document: existingDoc };
      }

      // 4. Đưa vào DocumentService để xử lý LangChain/Neo4j (Nếu chưa tồn tại)
      const meta = await this.documentService.uploadDocument(
        fileInfo.path,
        fileInfo.name,
        fileInfo.mimeType,
        fileInfo.size,
        {
          embeddingProvider: (dto.embeddingProvider || 'openai') as any,
          embeddingModel: dto.embeddingModel || 'text-embedding-3-small',
          ownerId: userId,
          hash: textHash, // Truyền hash để lưu vào Node Document
        },
      );

      // 5. Xóa file tạm sau khi đã lưu vào DB/Vector Store
      await fs.unlink(fileInfo.path).catch(() => {});

      return { document: meta };
    } catch (error) {
      // Xóa file tạm nếu có lỗi xảy ra
      if (require('fs').existsSync(tempPath)) {
        await fs.unlink(tempPath).catch(() => {});
      }
      throw error;
    }
  }
}

 