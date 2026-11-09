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
import { buildDocumentId } from './file-types';
import { FileValidationService } from './file-validation.service';
import { extractText } from './parsers/extract-text';

@Injectable()
export class DocumentsService {
  private embeddings: OpenAIEmbeddings;
  private embeddingsModel: string;
  private uploadDir: string;

  constructor(
    private configService: ConfigService,
    private databaseService: DatabaseService,
    private fileValidation: FileValidationService,
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

  async processAndStoreDocument(
    file: Express.Multer.File,
  ): Promise<{ id: string; chunks: number }> {
    const db = this.databaseService.getDb();

    // 1. Validar nombre, tipo, tamaño, firma y contenido del archivo
    const { safeName, type, mimeType, extension } =
      await this.fileValidation.validate(file);
    const filePath = this.resolveUploadPath(safeName);

    // 2. Extraer texto según el formato
    let text: string;
    try {
      text = await extractText(type, file.buffer);
    } catch {
      throw new BadRequestException(
        `No se pudo leer "${safeName}" como ${type.toUpperCase()}: ` +
          `el archivo puede estar dañado o no ser realmente un ${type.toUpperCase()}.`,
      );
    }

    if (!text.trim()) {
      throw new BadRequestException(
        `El documento "${safeName}" no contiene texto extraíble. ` +
          'Si es un PDF escaneado o una imagen necesitaría OCR, que esta app no incluye.',
      );
    }

    // 3. Guardar archivo físico (solo si se pudo extraer texto)
    fs.writeFileSync(filePath, file.buffer);

    // 4. Dividir en chunks
    const chunks = this.splitTextIntoChunks(text, 1000, 200);

    // 5. Generar embeddings
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

    // 6. Insertar documento, chunks y embeddings en una sola transacción
    const docId = buildDocumentId(safeName);

    const insertDocument = db.prepare(`
      INSERT INTO documents (id, filename, filepath, mime_type, extension)
      VALUES (?, ?, ?, ?, ?)
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

      insertDocument.run(docId, safeName, filePath, mimeType, extension);

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

  /** Resuelve la ruta dentro de UPLOAD_DIR y verifica que no se salga de ella. */
  private resolveUploadPath(safeName: string): string {
    const uploadDir = path.resolve(this.uploadDir);
    const filePath = path.resolve(uploadDir, safeName);

    if (!filePath.startsWith(uploadDir + path.sep)) {
      throw new BadRequestException('El nombre del archivo no es válido.');
    }

    return filePath;
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
