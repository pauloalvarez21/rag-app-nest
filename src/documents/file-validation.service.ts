import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as unzipper from 'unzipper';
import {
  allowedExtensions,
  detectFileType,
  FILE_TYPES,
  FileType,
  isProbablyUtf8Text,
  parseAllowedTypes,
  PLAIN_TEXT_TYPES,
  resolveSafeFilename,
  toBytes,
} from './file-types';

export interface ValidatedFile {
  type: FileType;
  safeName: string;
  mimeType: string;
  extension: string;
}

const MAX_ZIP_ENTRIES = 2000;
const MAX_COMPRESSION_RATIO = 1000;

@Injectable()
export class FileValidationService {
  private readonly allowedTypes: Set<FileType>;
  private readonly maxFileSizeBytes: number;
  private readonly maxUncompressedBytes: number;
  private readonly maxFileSizeMb: number;
  private readonly maxUncompressedMb: number;

  constructor(private readonly configService: ConfigService) {
    const rawTypes = this.configService.get<string>('ALLOWED_FILE_TYPES');
    this.allowedTypes = new Set(parseAllowedTypes(rawTypes));

    this.maxFileSizeMb = this.readMegabytes('MAX_FILE_SIZE_MB', 10);
    this.maxUncompressedMb = this.readMegabytes('MAX_UNCOMPRESSED_MB', 50);
    this.maxFileSizeBytes = toBytes(this.maxFileSizeMb, 10);
    this.maxUncompressedBytes = toBytes(this.maxUncompressedMb, 50);
  }

  async validate(file: Express.Multer.File): Promise<ValidatedFile> {
    const safeName = resolveSafeFilename(file?.originalname ?? '');
    const type = detectFileType(safeName);

    if (!type || !this.allowedTypes.has(type)) {
      throw new BadRequestException(
        `"${safeName}" no es un tipo de archivo permitido. ` +
          `Se aceptan: ${allowedExtensions(this.allowedTypes).join(', ')}.`,
      );
    }

    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(`El archivo "${safeName}" está vacío.`);
    }

    if (file.buffer.length > this.maxFileSizeBytes) {
      throw new BadRequestException(
        `El archivo "${safeName}" supera el máximo de ${this.maxFileSizeMb}MB.`,
      );
    }

    const definition = FILE_TYPES[type];

    if (
      definition.matchesSignature &&
      !definition.matchesSignature(file.buffer)
    ) {
      throw new BadRequestException(
        `El archivo "${safeName}" no es un ${type.toUpperCase()} válido: ` +
          `puede estar dañado o no ser realmente un ${type.toUpperCase()}.`,
      );
    }

    if (PLAIN_TEXT_TYPES.has(type) && !isProbablyUtf8Text(file.buffer)) {
      throw new BadRequestException(
        `El archivo "${safeName}" no parece texto UTF-8 válido.`,
      );
    }

    if (type === 'docx') {
      await this.assertSafeDocx(file.buffer, safeName);
    }

    return {
      type,
      safeName,
      mimeType: definition.mimeType,
      extension: definition.extensions[0],
    };
  }

  private readMegabytes(key: string, fallback: number): number {
    const value = Number(this.configService.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /**
   * Los DOCX son archivos ZIP: se inspecciona el directorio central (sin
   * descomprimir) para rechazar zip bombs y se confirma que el contenido es
   * WordprocessingML y no un ZIP cualquiera.
   */
  private async assertSafeDocx(
    buffer: Buffer,
    safeName: string,
  ): Promise<void> {
    let directory: unzipper.CentralDirectory;

    try {
      directory = await unzipper.Open.buffer(buffer);
    } catch {
      throw new BadRequestException(
        `El archivo "${safeName}" no es un DOCX válido (ZIP dañado).`,
      );
    }

    if (directory.files.length > MAX_ZIP_ENTRIES) {
      throw new BadRequestException(
        `El DOCX "${safeName}" contiene demasiados archivos internos.`,
      );
    }

    let uncompressedBytes = 0;
    for (const entry of directory.files) {
      uncompressedBytes += entry.uncompressedSize;
      if (uncompressedBytes > this.maxUncompressedBytes) {
        throw new BadRequestException(
          `El DOCX "${safeName}" se expande por encima de ` +
            `${this.maxUncompressedMb}MB (posible zip bomb).`,
        );
      }
    }

    if (
      buffer.length > 0 &&
      uncompressedBytes / buffer.length > MAX_COMPRESSION_RATIO
    ) {
      throw new BadRequestException(
        `El DOCX "${safeName}" tiene una compresión sospechosa ` +
          '(posible zip bomb).',
      );
    }

    const contentTypes = directory.files.find(
      (entry) => entry.path === '[Content_Types].xml',
    );

    if (!contentTypes) {
      throw new BadRequestException(
        `El archivo "${safeName}" no es un DOCX válido.`,
      );
    }

    let xml: string;
    try {
      xml = (await contentTypes.buffer()).toString('utf8');
    } catch {
      throw new BadRequestException(
        `El archivo "${safeName}" no es un DOCX válido.`,
      );
    }

    if (!xml.includes('wordprocessingml')) {
      throw new BadRequestException(
        `El archivo "${safeName}" no es un DOCX válido.`,
      );
    }
  }
}
