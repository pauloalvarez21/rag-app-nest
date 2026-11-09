import {
  BadRequestException,
  Controller,
  Post,
  Get,
  ParseFilePipe,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Falta el archivo: envíalo en el campo "file" como ' +
          'multipart/form-data. Ejemplo: ' +
          'curl -X POST http://localhost:3000/api/v1/documents/upload -F "file=@documento.pdf"',
      );
    }

    const result = await this.documentsService.processAndStoreDocument(file);
    return {
      message: 'Documento procesado exitosamente',
      documentId: result.id,
      chunks: result.chunks,
    };
  }

  @Get()
  listDocuments() {
    return { documents: this.documentsService.listDocuments() };
  }
}
