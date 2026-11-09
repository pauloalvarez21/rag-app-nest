import { BadRequestException, HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';
import { DocumentsService } from './documents.service';
import { DatabaseService } from '../database/database.service';
import { EMBEDDING_DIMENSIONS } from '../config/embeddings.config';

/** ConfigService falso: los servicios solo usan `get` y `getOrThrow`. */
function fakeConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) {
        throw new Error(`Falta la variable ${key}`);
      }
      return values[key];
    },
  } as unknown as ConfigService;
}

/**
 * Genera un PDF mínimo y válido a mano (xref con offsets reales) para
 * ejercitar la extracción de texto de pdf-parse de verdad. El texto va en
 * líneas de 60 caracteres con `T*`: un único `Tj` gigante lo recorta pdf.js.
 */
function textPdf(text: string): Buffer {
  const escape = (value: string) =>
    value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += 60) {
    lines.push(text.slice(i, i + 60));
  }
  const content = `BT /F1 12 Tf 72 720 Td\n${lines
    .map((line) => `(${escape(line)}) Tj T*`)
    .join('\n')}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

function uploadFile(
  buffer: Buffer,
  originalname = 'documento_prueba.pdf',
): Express.Multer.File {
  return {
    originalname,
    buffer,
    mimetype: 'application/pdf',
    size: buffer.length,
  } as unknown as Express.Multer.File;
}

/** Vector de 1536 dimensiones con un 1 en la posición dada. */
function unitVector(index: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[index % EMBEDDING_DIMENSIONS] = 1;
  return vector;
}

describe('DocumentsService (ingesta real con sqlite-vec)', () => {
  let uploadDir: string;
  let databaseService: DatabaseService;
  let service: DocumentsService;
  let embeddings: { embedDocuments: jest.Mock; embedQuery: jest.Mock };
  let consoleSpy: jest.SpyInstance;

  // Texto lo bastante largo para forzar varios chunks (tamaño 1000, solape 200).
  const longText =
    'Lumina Orbital despliega satelites de observacion terrestre. '
      .repeat(60)
      .slice(0, 4000);

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-uploads-'));
    databaseService = new DatabaseService(
      fakeConfig({ DATABASE_PATH: ':memory:' }),
    );
    databaseService.onModuleInit();

    service = new DocumentsService(
      fakeConfig({
        UPLOAD_DIR: uploadDir,
        EMBEDDINGS_API_KEY: 'clave-de-prueba',
        EMBEDDINGS_BASE_URL: 'http://localhost:9999/v1',
        EMBEDDINGS_MODEL: 'openai/text-embedding-3-small',
      }),
      databaseService,
    );

    embeddings = {
      embedDocuments: jest.fn(),
      embedQuery: jest.fn(),
    };
    embeddings.embedDocuments.mockImplementation((chunks: string[]) =>
      Promise.resolve(chunks.map((_, index) => unitVector(index))),
    );
    (service as unknown as { embeddings: typeof embeddings }).embeddings =
      embeddings;
  });

  afterEach(() => {
    databaseService.onModuleDestroy();
    fs.rmSync(uploadDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
  });

  it('extrae el texto, lo parte en chunks y guarda documento y vectores', async () => {
    const file = uploadFile(textPdf(longText));

    // pdf-parse añade un marcador de página al final, así que se calcula el
    // troceado esperado contra la extracción real, no contra el texto fuente.
    const parser = new PDFParse({ data: file.buffer });
    let extracted: string;
    try {
      extracted = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }

    const result = await service.processAndStorePDF(file);

    const db = databaseService.getDb();
    const documents = db
      .prepare('SELECT id, filename FROM documents')
      .all() as { id: string; filename: string }[];
    const chunks = db
      .prepare('SELECT content, source FROM chunks ORDER BY rowid')
      .all() as { content: string; source: string }[];
    const vectors = db
      .prepare('SELECT id, embedding FROM vec_chunks')
      .all() as { id: string; embedding: Buffer }[];

    expect(result.id).toBe('documento_prueba');
    // El texto extraído supera el tamaño de chunk: debe haber varios.
    expect(extracted.length).toBeGreaterThan(1000);
    expect(result.chunks).toBeGreaterThan(1);
    expect(documents).toEqual([
      { id: 'documento_prueba', filename: 'documento_prueba.pdf' },
    ]);
    expect(chunks).toHaveLength(result.chunks);
    expect(vectors).toHaveLength(result.chunks);

    // Troceado con tamaño 1000 y solape 200: el segundo chunk empieza en 800.
    expect(chunks[0].content).toBe(extracted.slice(0, 1000));
    expect(chunks[1].content).toBe(extracted.slice(800, 1800));
    expect(chunks.every((c) => c.source === 'documento_prueba.pdf')).toBe(true);

    // Cada vector es un FLOAT[1536] serializado en little-endian.
    expect(
      vectors.every((v) => v.embedding.length === EMBEDDING_DIMENSIONS * 4),
    ).toBe(true);

    // El archivo físico quedó en UPLOAD_DIR.
    expect(fs.existsSync(path.join(uploadDir, 'documento_prueba.pdf'))).toBe(
      true,
    );
    expect(service.listDocuments()).toHaveLength(1);
  });

  it('reemplaza la versión anterior al re-subir el mismo PDF', async () => {
    const file = uploadFile(textPdf(longText));

    const first = await service.processAndStorePDF(file);
    // Antes fallaba con "UNIQUE constraint failed: documents.id".
    const second = await service.processAndStorePDF(file);
    expect(second).toEqual(first);

    const db = databaseService.getDb();
    const count = (sql: string) =>
      (db.prepare(sql).get() as { total: number }).total;

    expect(count('SELECT COUNT(*) AS total FROM documents')).toBe(1);
    expect(count('SELECT COUNT(*) AS total FROM chunks')).toBe(first.chunks);
    expect(count('SELECT COUNT(*) AS total FROM vec_chunks')).toBe(
      first.chunks,
    );
    expect(embeddings.embedDocuments).toHaveBeenCalledTimes(2);
  });

  it('devuelve un error claro ante un PDF corrupto', async () => {
    const error = await service
      .processAndStorePDF(uploadFile(Buffer.from('esto no es un PDF')))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain('dañado');
  });

  it('rechaza nombres de archivo con rutas (path traversal)', async () => {
    const error = await service
      .processAndStorePDF(uploadFile(textPdf('contenido'), '../evil.pdf'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain('no es válido');
    expect(embeddings.embedDocuments).not.toHaveBeenCalled();
  });

  it('rechaza archivos cuya extensión no es .pdf', async () => {
    const error = await service
      .processAndStorePDF(uploadFile(textPdf('contenido'), 'notas.txt'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain('no es un PDF');
    expect(embeddings.embedDocuments).not.toHaveBeenCalled();
  });

  it('traduce los errores del proveedor de embeddings a un 502 accionable', async () => {
    embeddings.embedDocuments.mockRejectedValueOnce({
      status: 404,
      code: 'model_not_found',
      message: 'The model `x` does not exist or you do not have access to it.',
    });

    const error = await service
      .processAndStorePDF(uploadFile(textPdf('texto corto')))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(502);
    expect(JSON.stringify((error as HttpException).getResponse())).toContain(
      'EMBEDDINGS_MODEL',
    );
  });

  it('avisa si el modelo devuelve una dimensión distinta a la tabla', async () => {
    embeddings.embedDocuments.mockResolvedValueOnce([
      new Array<number>(512).fill(0),
    ]);

    const error = await service
      .processAndStorePDF(uploadFile(textPdf('texto corto')))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(500);
    const body = JSON.stringify((error as HttpException).getResponse());
    expect(body).toContain('512');
    expect(body).toContain(`FLOAT[${EMBEDDING_DIMENSIONS}]`);
  });
});
