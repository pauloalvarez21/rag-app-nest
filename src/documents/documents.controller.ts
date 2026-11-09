import {
  BadRequestException,
  Controller,
  Post,
  Get,
  ParseFilePipe,
  MaxFileSizeValidator,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { PdfFileValidator } from './pipes/pdf-file.validator';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPDF(
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new MaxFileSizeValidator({
            maxSize: MAX_FILE_SIZE,
            message: 'El PDF no puede superar los 10MB.',
          }),
          new PdfFileValidator(),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Falta el archivo: envía el PDF en el campo "file" como ' +
          'multipart/form-data. Ejemplo: ' +
          'curl -X POST http://localhost:3000/api/v1/documents/upload -F "file=@documento.pdf"',
      );
    }

    const isPdf =
      file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);

    if (!isPdf) {
      throw new BadRequestException(
        `"${file.originalname}" no es un PDF. Solo se aceptan archivos .pdf ` +
          '(máximo 10MB).',
      );
    }

    const result = await this.documentsService.processAndStorePDF(file);
    return {
      message: 'PDF procesado exitosamente',
      documentId: result.id,
      chunks: result.chunks,
    };
  }

  @Get()
  listDocuments() {
    return { documents: this.documentsService.listDocuments() };
  }
}
