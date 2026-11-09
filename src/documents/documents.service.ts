import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { DatabaseService } from '../database/database.service';
import {
  assertEmbeddingDimensions,
  createEmbeddings,
} from '../config/embeddings.config';
import { toHttpException } from '../config/provider-errors';
import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class DocumentsService {
  private embeddings: OpenAIEmbeddings;
  private embeddingsModel: string;
  private uploadDir: string;

  constructor(
    private configService: ConfigService,
    private databaseService: DatabaseService,
  ) {
    this.uploadDir = this.configService.getOrThrow<string>('UPLOAD_DIR');
    this.embeddingsModel =
      this.configService.get<string>('EMBEDDINGS_MODEL') ??
      'openai/text-embedding-3-small';

    // Crear carpeta de uploads si no existe
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }

    this.embeddings = createEmbeddings(this.configService);
  }

  async processAndStorePDF(
    file: Express.Multer.File,
  ): Promise<{ id: string; chunks: number }> {
    const db = this.databaseService.getDb();
    const safeName = this.resolveSafeFilename(file.originalname);
    const filePath = this.resolveUploadPath(safeName);

    if (!this.hasPdfSignature(file.buffer)) {
      throw new BadRequestException(
        `No se pudo leer "${safeName}" como PDF: el archivo puede estar ` +
          'dañado, protegido con contraseña o no ser realmente un PDF.',
      );
    }

    // 1. Guardar archivo físico
    fs.writeFileSync(filePath, file.buffer);

    // 2. Extraer texto del PDF (pdf-parse v2 usa la clase PDFParse)
    const parser = new PDFParse({ data: file.buffer });
    let text: string;
    try {
      const pdfData = await parser.getText();
      text = pdfData.text;
    } catch {
      throw new BadRequestException(
        `No se pudo leer "${safeName}" como PDF: el archivo puede estar ` +
          'dañado, protegido con contraseña o no ser realmente un PDF.',
      );
    } finally {
      await parser.destroy();
    }

    if (!text.trim()) {
      throw new BadRequestException(
        `El PDF "${safeName}" no contiene texto extraíble. ` +
          'Si es un documento escaneado necesitaría OCR, que esta app no incluye.',
      );
    }

    // 3. Dividir en chunks
    const chunks = this.splitTextIntoChunks(text, 1000, 200);

    // 4. Generar embeddings
    let embeddings: number[][];
    try {
      embeddings = await this.embeddings.embedDocuments(chunks);
    } catch (error) {
      throw toHttpException(error, {
        provider: 'embeddings (EMBEDDINGS_BASE_URL)',
        modelVar: 'EMBEDDINGS_MODEL',
        apiKeyVar: 'EMBEDDINGS_API_KEY',
        model: this.embeddingsModel,
      });
    }

    assertEmbeddingDimensions(embeddings[0], this.embeddingsModel);

    // 5. Insertar documento, chunks y embeddings en una sola transacción
    const docId = safeName.replace(/\.[^.]+$/, '');

    const insertDocument = db.prepare(`
      INSERT INTO documents (id, filename, filepath)
      VALUES (?, ?, ?)
    `);

    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, content, source)
      VALUES (?, ?, ?, ?)
    `);

    const insertEmbedding = db.prepare(`
      INSERT INTO vec_chunks (id, embedding)
      VALUES (?, ?)
    `);

    // vec_chunks no tiene foreign key, así que hay que borrar sus filas aparte
    const deleteEmbedding = db.prepare('DELETE FROM vec_chunks WHERE id = ?');
    const deleteChunks = db.prepare('DELETE FROM chunks WHERE document_id = ?');
    const deleteDocument = db.prepare('DELETE FROM documents WHERE id = ?');
    const selectChunkIds = db.prepare(
      'SELECT id FROM chunks WHERE document_id = ?',
    );

    const insertTransaction = db.transaction(() => {
      // Re-subida del mismo archivo: reemplazar la versión anterior
      const previousChunks = selectChunkIds.all(docId) as { id: string }[];
      for (const { id } of previousChunks) {
        deleteEmbedding.run(id);
      }
      deleteChunks.run(docId);
      deleteDocument.run(docId);

      insertDocument.run(docId, safeName, filePath);

      chunks.forEach((chunk, index) => {
        const chunkId = `${docId}_chunk_${index}`;

        // Insertar chunk
        insertChunk.run(chunkId, docId, chunk, safeName);

        // Insertar embedding (convertir a buffer)
        const embeddingBuffer = this.float32ArrayToBuffer(embeddings[index]);
        insertEmbedding.run(chunkId, embeddingBuffer);
      });
    });

    insertTransaction();

    return { id: docId, chunks: chunks.length };
  }

  /**
   * Rechaza nombres con rutas o caracteres nulos y exige extensión .pdf.
   * Evita que un `originalname` malicioso escape del directorio de subidas.
   */
  private resolveSafeFilename(originalName: string): string {
    const safeName = path.basename(originalName);

    if (
      safeName !== originalName ||
      safeName === '.' ||
      safeName === '..' ||
      safeName.includes('\0')
    ) {
      throw new BadRequestException('El nombre del archivo no es válido.');
    }

    if (!/\.pdf$/i.test(safeName)) {
      throw new BadRequestException(
        `"${safeName}" no es un PDF. Solo se aceptan archivos .pdf (máximo 10MB).`,
      );
    }

    return safeName;
  }

  /** Resuelve la ruta dentro de UPLOAD_DIR y verifica que no se salga de ella. */
  private resolveUploadPath(safeName: string): string {
    const uploadDir = path.resolve(this.uploadDir);
    const filePath = path.resolve(uploadDir, safeName);

    if (!filePath.startsWith(uploadDir + path.sep)) {
      throw new BadRequestException('El nombre del archivo no es válido.');
    }

    return filePath;
  }

  private hasPdfSignature(buffer: Buffer | undefined): boolean {
    const signature = Buffer.from('%PDF-');
    return (
      !!buffer &&
      buffer.length >= signature.length &&
      buffer.subarray(0, signature.length).equals(signature)
    );
  }

  private splitTextIntoChunks(
    text: string,
    chunkSize: number,
    overlap: number,
  ): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.slice(start, end));
      start += chunkSize - overlap;
    }

    return chunks;
  }

  private float32ArrayToBuffer(floatArray: number[]): Buffer {
    const buffer = Buffer.alloc(floatArray.length * 4);
    floatArray.forEach((value, index) => {
      buffer.writeFloatLE(value, index * 4);
    });
    return buffer;
  }
  listDocuments(): any[] {
    const db = this.databaseService.getDb();
    return db
      .prepare('SELECT * FROM documents ORDER BY uploaded_at DESC')
      .all();
  }

  /** Elimina un documento y todos sus chunks y embeddings de la base de datos. */
  deleteById(id: string): void {
    const db = this.databaseService.getDb();

    // vec_chunks no tiene foreign key: hay que borrar sus filas por el id de
    // cada chunk (no por el id del documento).
    const selectChunkIds = db.prepare(
      'SELECT id FROM chunks WHERE document_id = ?',
    );
    const deleteEmbedding = db.prepare('DELETE FROM vec_chunks WHERE id = ?');
    const deleteChunks = db.prepare('DELETE FROM chunks WHERE document_id = ?');
    const deleteDocument = db.prepare('DELETE FROM documents WHERE id = ?');

    const transaction = db.transaction(() => {
      const chunkIds = selectChunkIds.all(id) as { id: string }[];
      for (const { id: chunkId } of chunkIds) {
        deleteEmbedding.run(chunkId);
      }
      deleteChunks.run(id);
      deleteDocument.run(id);
    });

    transaction();
  }
}
