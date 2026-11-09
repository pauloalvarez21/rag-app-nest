import { BadRequestException } from '@nestjs/common';
import * as path from 'path';

export type FileType = 'pdf' | 'docx' | 'txt' | 'md' | 'html' | 'csv';

export interface FileTypeDefinition {
  type: FileType;
  extensions: string[];
  mimeType: string;
  /** Firma binaria esperada, si el formato tiene una fiable. */
  matchesSignature?: (buffer: Buffer) => boolean;
}

export const DEFAULT_ALLOWED_FILE_TYPES: FileType[] = [
  'pdf',
  'docx',
  'txt',
  'md',
  'html',
  'csv',
];

/** Extensiones que se indexan como texto plano (sin parser estructurado). */
export const PLAIN_TEXT_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  'txt',
  'md',
  'csv',
]);

const PDF_SIGNATURE = Buffer.from('%PDF-');

export const FILE_TYPES: Record<FileType, FileTypeDefinition> = {
  pdf: {
    type: 'pdf',
    extensions: ['pdf'],
    mimeType: 'application/pdf',
    matchesSignature: (buffer) =>
      buffer.length >= PDF_SIGNATURE.length &&
      buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE),
  },
  docx: {
    type: 'docx',
    extensions: ['docx'],
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    matchesSignature: isZipSignature,
  },
  txt: { type: 'txt', extensions: ['txt'], mimeType: 'text/plain' },
  md: { type: 'md', extensions: ['md'], mimeType: 'text/markdown' },
  html: {
    type: 'html',
    extensions: ['html', 'htm'],
    mimeType: 'text/html',
  },
  csv: { type: 'csv', extensions: ['csv'], mimeType: 'text/csv' },
};

const EXTENSION_TO_TYPE: Record<string, FileType> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
  md: 'md',
  html: 'html',
  htm: 'html',
  csv: 'csv',
};

/** Devuelve la extensión en minúsculas y sin punto. */
export function getExtension(filename: string): string {
  return path.extname(filename).slice(1).toLowerCase();
}

/** Detecta el tipo canónico por extensión (`.htm` se normaliza a `html`). */
export function detectFileType(filename: string): FileType | null {
  return EXTENSION_TO_TYPE[getExtension(filename)] ?? null;
}

/**
 * Convierte `ALLOWED_FILE_TYPES` (lista separada por comas) en tipos válidos.
 * Acepta tanto nombres de tipo como extensiones (`htm` → `html`).
 */
export function parseAllowedTypes(raw?: string): FileType[] {
  if (!raw?.trim()) {
    return [...DEFAULT_ALLOWED_FILE_TYPES];
  }

  const types = new Set<FileType>();
  for (const value of raw.split(',')) {
    const type = EXTENSION_TO_TYPE[value.trim().toLowerCase()];
    if (type) {
      types.add(type);
    }
  }

  return types.size > 0 ? [...types] : [...DEFAULT_ALLOWED_FILE_TYPES];
}

/** Lista de extensiones aceptadas, para mensajes de error. */
export function allowedExtensions(types: Iterable<FileType>): string[] {
  return [...types].map((type) => FILE_TYPES[type].extensions[0]);
}

/**
 * `docId` estable y sin colisiones entre formatos: `informe.pdf` → `informe-pdf`
 * e `informe.docx` → `informe-docx`.
 */
export function buildDocumentId(filename: string): string {
  const extension = getExtension(filename);
  const type = EXTENSION_TO_TYPE[extension];

  if (!type) {
    throw new BadRequestException(
      `"${filename}" no tiene una extensión de archivo admitida.`,
    );
  }

  const base = filename.slice(0, filename.length - extension.length - 1);
  if (!base) {
    throw new BadRequestException(
      `"${filename}" no tiene un nombre de archivo válido.`,
    );
  }

  return `${base}-${FILE_TYPES[type].extensions[0]}`;
}

/**
 * Rechaza nombres con rutas o caracteres nulos. Evita que un `originalname`
 * malicioso escape del directorio de subidas.
 */
export function resolveSafeFilename(originalName: string): string {
  const safeName = path.basename(originalName);

  if (
    safeName !== originalName ||
    safeName === '.' ||
    safeName === '..' ||
    safeName.includes('\0')
  ) {
    throw new BadRequestException('El nombre del archivo no es válido.');
  }

  return safeName;
}

/** Firma de un ZIP (`PK\x03\x04`), contenedor de los formatos Office OOXML. */
export function isZipSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

/** Heurística para formatos de texto: UTF-8 válido y sin bytes NUL. */
export function isProbablyUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return false;
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/** Convierte un valor en MB a bytes, con un valor por defecto si no es válido. */
export function toBytes(
  value: string | number | undefined,
  fallbackMb: number,
): number {
  const megabytes = Number(value);
  const effective =
    Number.isFinite(megabytes) && megabytes > 0 ? megabytes : fallbackMb;
  return Math.floor(effective * 1024 * 1024);
}
