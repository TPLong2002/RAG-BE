import { Injectable, UnauthorizedException } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class GoogleDriveService {
  private oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

  private TOKEN_PATH = path.join(process.cwd(), 'token.json');

  constructor() {
    // Lắng nghe sự kiện 'tokens' để tự động cập nhật file token.json
    this.oauth2Client.on('tokens', (tokens) => {
      if (fs.existsSync(this.TOKEN_PATH)) {
        const currentTokens = JSON.parse(
          fs.readFileSync(this.TOKEN_PATH, 'utf8'),
        );
        // Ghi đè token mới (access_token) nhưng vẫn giữ lại refresh_token cũ
        fs.writeFileSync(
          this.TOKEN_PATH,
          JSON.stringify({ ...currentTokens, ...tokens }, null, 2),
        );
        console.log(
          '🔄 [Hệ thống] Đã tự động cập nhật access_token mới vào token.json',
        );
      }
    });
  }

  // Kiểm tra và làm mới token trước khi trả về Drive Client
  private async getAuthenticatedClient() {
    if (!fs.existsSync(this.TOKEN_PATH))
      throw new UnauthorizedException('AUTH_REQUIRED');

    const tokens = JSON.parse(fs.readFileSync(this.TOKEN_PATH, 'utf8'));
    this.oauth2Client.setCredentials(tokens);

    try {
      // kiểm tra hạn token.
      // Nếu hết hạn, gọi lệnh refresh và kích hoạt event 'tokens' ở constructor.
      await this.oauth2Client.getAccessToken();

      return google.drive({ version: 'v3', auth: this.oauth2Client });
    } catch (err) {
      console.error('❌ [Hệ thống] Không thể làm mới token:', err.message);
      throw new UnauthorizedException('REFRESH_TOKEN_EXPIRED');
    }
  }

  getAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // để lấy refresh_token
      scope: ['https://www.googleapis.com/auth/drive'],
      prompt: 'consent', // để luôn nhận được refresh_token khi login lại
    });
  }

  async setTokens(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    fs.writeFileSync(this.TOKEN_PATH, JSON.stringify(tokens, null, 2));
    return tokens;
  }

  async listFiles(folderId = 'root', search = '') {
    const drive = await this.getAuthenticatedClient();

    let query = `trashed = false`;
    if (search) {
      query += ` and name contains '${search.replace(/'/g, "\\'")}'`;
    } else {
      query += ` and '${folderId}' in parents`;
    }

    const res = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, size, webViewLink, iconLink)',
      orderBy: 'folder, name',
      pageSize: 100,
    });
    return res.data.files;
  }

  async downloadFile(fileId: string, destPath: string) {
    const drive = await this.getAuthenticatedClient();

    // 1. Lấy thông tin file gốc
    const meta = await drive.files.get({ fileId, fields: 'name, mimeType' });
    const mimeType = meta.data?.mimeType || '';
    let finalName = meta.data?.name || 'file';
    let tempDriveFileId: string | undefined = undefined;

    try {
      let response: any;

      // TRƯỜNG HỢP 1: File đã là PDF -> Tải trực tiếp
      if (mimeType === 'application/pdf') {
        response = await drive.files.get(
          { fileId, alt: 'media' },
          { responseType: 'stream' },
        );
      }
      // TRƯỜNG HỢP 2: File gốc nội bộ của Google (Docs, Sheets, Slides) -> Export trực tiếp
      else if (mimeType.includes('vnd.google-apps')) {
        response = await drive.files.export(
          { fileId, mimeType: 'application/pdf' },
          { responseType: 'stream' },
        );
        finalName = finalName.replace(/\.[^/.]+$/, '') + '.pdf';
      }
      // TRƯỜNG HỢP 3: File cần phải CONVERT sang PDF (Word, Excel, CSV, TXT)
      else if (
        mimeType.includes('officedocument') || // Word, Excel (.docx, .xlsx)
        mimeType.includes('text/plain') || // TXT
        mimeType.includes('text/csv') || // CSV
        finalName.endsWith('.docx') ||
        finalName.endsWith('.xlsx') ||
        finalName.endsWith('.csv') ||
        finalName.endsWith('.txt')
      ) {
        console.log(`🔄 Đang chuẩn bị convert sang PDF: ${finalName}`);

        // Lấy luồng dữ liệu file gốc
        const originalFile = await drive.files.get(
          { fileId, alt: 'media' },
          { responseType: 'stream' },
        );

        // Xác định loại Google App tạm thời dựa trên file gốc
        // Nếu là CSV hoặc Excel thì biến thành Google Sheet, còn lại biến thành Google Doc
        const isSpreadsheet =
          mimeType.includes('spreadsheet') ||
          mimeType.includes('csv') ||
          finalName.endsWith('.xlsx') ||
          finalName.endsWith('.csv');

        const targetGoogleMime = isSpreadsheet
          ? 'application/vnd.google-apps.spreadsheet'
          : 'application/vnd.google-apps.document';

        // TẠO FILE TẠM TRÊN DRIVE ĐỂ GOOGLE TỰ CONVERT NỘI DUNG
        const tempFile = await drive.files.create({
          requestBody: {
            name: `temp_convert_${Date.now()}`,
            mimeType: targetGoogleMime,
          },
          media: {
            mimeType: mimeType, // để Google biết định dạng gốc là gì
            body: originalFile.data,
          },
          fields: 'id',
        });

        tempDriveFileId = tempFile.data.id as string;

        // EXPORT FILE TẠM VỪA TẠO SANG PDF
        response = await drive.files.export(
          { fileId: tempDriveFileId, mimeType: 'application/pdf' },
          { responseType: 'stream' },
        );

        // Chuẩn hóa tên file thành .pdf
        finalName = finalName.replace(/\.[^/.]+$/, '') + '.pdf';
      }
      // TRƯỜNG HỢP 4: Các file khác không hỗ trợ convert (Ảnh, Zip, v.v...) -> Tải gốc
      else {
        response = await drive.files.get(
          { fileId, alt: 'media' },
          { responseType: 'stream' },
        );
      }

      // GHI DỮ LIỆU XUỐNG SERVER LOCAL
      const writer = fs.createWriteStream(destPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', () => {
          writer.close();
          resolve(true);
        });
        writer.on('error', (err) => {
          writer.close();
          reject(err);
        });
      });

      // Kiểm tra xem file có phải là PDF không
      const isPdf = finalName.toLowerCase().endsWith('.pdf');

      return {
        path: destPath,
        name: finalName,
        mimeType: isPdf ? 'application/pdf' : mimeType,
        size: fs.statSync(destPath).size,
      };
    } catch (error) {
      console.error('❌ Lỗi trong quá trình download/convert:', error.message);
      throw error;
    } finally {
      // DỌN DẸP FILE TẠM TRÊN DRIVE ĐỂ TRÁNH RÁC TRONG DRIVE CỦA USER
      if (tempDriveFileId) {
        await drive.files.delete({ fileId: tempDriveFileId }).catch(() => {});
        console.log('🧹 Đã dọn dẹp file tạm trên Google Drive.');
      }
    }
  }
}
