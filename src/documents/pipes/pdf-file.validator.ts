import { FileValidator } from '@nestjs/common';

const PDF_SIGNATURE = Buffer.from('%PDF-');

/** Comprueba que el archivo empieza por la firma real de un PDF (`%PDF-`). */
export class PdfFileValidator extends FileValidator<Record<string, never>> {
  constructor() {
    super({});
  }

  isValid(file?: Express.Multer.File): boolean {
    if (!file?.buffer || file.buffer.length < PDF_SIGNATURE.length) {
      return false;
    }

    return file.buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
  }

  buildErrorMessage(): string {
    return 'El archivo no es un PDF válido (no se encontró la firma %PDF-).';
  }
}
