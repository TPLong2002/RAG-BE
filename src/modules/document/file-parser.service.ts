import { Injectable } from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv';
import { promises as fs } from 'fs';

export interface ParsedFile {
  docs: Document[];
  fileType: string;
}

@Injectable()
export class FileParserService {
  private MIME_MAP: Record<
    string,
    (path: string) => { loader: { load(): Promise<Document[]> }; fileType: string }
  > = {
    'application/pdf': (path) => ({
      loader: new PDFLoader(path, {
        splitPages: true,
        pdfjs: () => import('pdfjs-dist/legacy/build/pdf.mjs'),
      }),
      fileType: 'pdf',
    }),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (path) => ({
      loader: new DocxLoader(path),
      fileType: 'docx',
    }),
    'application/msword': (path) => ({
      loader: new DocxLoader(path),
      fileType: 'doc',
    }),
    'text/csv': (path) => ({
      loader: new CSVLoader(path),
      fileType: 'csv',
    }),
    'application/csv': (path) => ({
      loader: new CSVLoader(path),
      fileType: 'csv',
    }),
    'text/plain': (path) => ({
      loader: {
        async load() {
          const text = await fs.readFile(path, 'utf-8');
          return [new Document({ pageContent: text, metadata: { source: path } })];
        },
      },
      fileType: 'txt',
    }),
  };

  async parseFile(filePath: string, mimeType: string): Promise<ParsedFile> {
    const factory = this.MIME_MAP[mimeType];
    if (!factory) throw new Error(`Unsupported file type: ${mimeType}`);

    const { loader, fileType } = factory(filePath);
    const docs = await loader.load();

    return { docs, fileType };
  }
}
