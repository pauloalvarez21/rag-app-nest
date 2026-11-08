import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';

import { DocumentsService } from './documents.service';

/**
 * Servicio que consume documentos escritos en un directorio en lugar de
 * recibirlos mediante una petición HTTP.
 *
 * Modo de funcionamiento:
 *
 * 1. Observador de eventos: cuando chokidar detecta `add` o `addDir` en el
 *    directorio, se procesa el archivo.
 * 2. Escaneo periódico (fallback): se recorre el directorio cada
 *    `SCAN_INTERVAL_MS` y se procesa cada archivo no procesado aún.
 *
 * Cuando se elimina un archivo del directorio:
 *
 * - Se borra el fichero del disco.
 * - Se elimina el documento de la ingesta: sus chunk y embeddings.
 */
@Injectable()
export class DirectoryIngestorService implements OnModuleInit {
  private readonly watchDir: string;
  private readonly scanIntervalMs: number;
  private readonly once: boolean;

  private watcher: chokidar.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private processed: Set<string> = new Set();
  private readonly tooManyErrors = 10;
  private errorCount = 0;

  constructor(
    private configService: ConfigService,
    private documentsService: DocumentsService,
  ) {
    this.watchDir =
      this.configService.get<string>('WATCH_DIR') ??
      this.configService.getOrThrow<string>('UPLOAD_DIR');

    this.scanIntervalMs =
      this.configService.get<number>('SCAN_INTERVAL_MS') ?? 5000;

    this.once = this.configService.get<boolean>('WATCH_ONCE') ?? false;

    this.watchDir = path.resolve(this.watchDir);
  }

  onModuleInit() {
    fs.mkdirSync(this.watchDir, { recursive: true, mode: 0o755 });

    this.watcher = chokidar.watch(this.watchDir, {
      atomic: false,
      ignoreInitial: true,
      persistent: true,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher
      .on('add', (filePath) => this.handleAdd(filePath))
      .on('addDir', (dirPath) => this.handleAddDir(dirPath))
      .on('unlink', (filePath) => this.handleUnlink(filePath))
      .on('error', (error) => {
        const isWatchError =
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'EBUSY';
        if (isWatchError) {
          // El error EBUSY suele ser temporal: el sistema operativo tiene el
          // archivo en uso. No lo sale por consola mil veces, solo lo cuenta.
          this.errorCount += 1;
          if (this.errorCount <= this.tooManyErrors) {
            console.warn(
              `[DirectoryIngestor] watcher EBUSY en ${this.watchDir} (intento ${this.errorCount}/${this.tooManyErrors})`,
            );
          }
          return;
        }

        console.error(
          `[DirectoryIngestor] error observando ${this.watchDir}:`,
          error,
        );
      })
      .on('ready', () => {
        this.errorCount = 0;
        console.log(
          `[DirectoryIngestor] observando ${this.watchDir} en tiempo real`,
        );
      });

    if (this.once) {
      this.watcher.on('add', () => {
        if (!this.once) {
          return;
        }
        void this.watcher!.close();
      });
    }

    if (this.scanIntervalMs > 0) {
      this.timer = setInterval(() => {
        this.scanDirectory();
      }, this.scanIntervalMs);
    }
  }

  onModuleDestroy() {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Se llama cuando chokidar detecta un nuevo archivo. */
  private handleAdd(filePath: string): void {
    void this.processFilePath(filePath);
  }

  /** Se llama cuando chokidar detecta un nuevo directorio. */
  private handleAddDir(dirPath: string): void {
    console.log(`[DirectoryIngestor] directorio añadido: ${dirPath}`);
  }

  /** Elimina el documento de la ingesta cuando desaparece del directorio. */
  private handleUnlink(filePath: string): void {
    if (!/\.pdf$/i.test(filePath)) {
      return;
    }

    // El evento unlink significa que el sistema operativo ya indicó que el
    // fichero no está más, así que no hay que volver a borrarlo del disco.
    const fileId = path.basename(filePath);
    const docId = fileId.replace(/\.pdf$/i, '');

    this.removeDocument(docId, fileId);
  }

  /** Elimina un documento de la base de datos. */
  private removeDocument(docId: string, fileId: string): void {
    try {
      this.documentsService.deleteById(docId);
      this.processed.delete(fileId);

      console.log(`[DirectoryIngestor] documento eliminado: ${docId}`);
    } catch (error) {
      console.error(
        `[DirectoryIngestor] error eliminando el documento ${docId}:`,
        error,
      );
    }
  }

  /** Escanea el directorio y procesa cada archivo no procesado. */
  private scanDirectory(): void {
    try {
      const entries = fs.readdirSync(this.watchDir, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          continue;
        }

        const filePath = path.join(this.watchDir, entry.name);
        void this.processFilePath(filePath);
      }
    } catch (error) {
      console.error(
        `[DirectoryIngestor] error escaneando ${this.watchDir}:`,
        error,
      );
    }
  }

  /** Procesa un archivo del directorio. */
  private async processFilePath(filePath: string): Promise<void> {
    const fileId = path.basename(filePath);
    if (!/\.pdf$/i.test(fileId) || this.processed.has(fileId)) {
      return;
    }

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size === 0) {
        return;
      }
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        return;
      }
    } catch {
      // El archivo puede desaparecer o estar bloqueado entre el evento y el
      // acceso: no es un fallo crítico y el siguiente escaneo lo reintentará.
      return;
    }

    this.processed.add(fileId);

    try {
      const buffer = fs.readFileSync(filePath);
      const file = {
        originalname: fileId,
        buffer,
        mimetype: 'application/pdf',
        size: buffer.length,
      } as Express.Multer.File;

      await this.documentsService.processAndStorePDF(file);

      console.log(`[DirectoryIngestor] ingesta completada: ${fileId}`);
    } catch (error) {
      // Si falla, se quita del conjunto para reintentarlo en el próximo escaneo.
      this.processed.delete(fileId);
      console.error(`[DirectoryIngestor] error procesando ${filePath}:`, error);
    }
  }
}
