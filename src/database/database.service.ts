import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import vec from 'sqlite-vec';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private db: Database.Database;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const dbPath = this.configService.getOrThrow<string>('DATABASE_PATH');

    // Crear carpeta data si no existe
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Inicializar SQLite
    this.db = new Database(dbPath);

    // Cargar extensión sqlite-vec
    vec.load(this.db);

    // Crear tablas
    this.initializeTables();

    this.logger.log('Base de datos SQLite inicializada con sqlite-vec');
  }

  onModuleDestroy() {
    if (this.db) {
      this.db.close();
    }
  }

  private initializeTables() {
    // Tabla de documentos (PDF, DOCX, TXT, MD, HTML y CSV)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        mime_type TEXT,
        extension TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migración tolerante para bases de datos creadas antes del multi-formato.
    this.ensureColumn('documents', 'mime_type', 'TEXT');
    this.ensureColumn('documents', 'extension', 'TEXT');

    // Tabla de chunks (fragmentos de texto)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id)
      )
    `);

    // Tabla virtual de sqlite-vec para embeddings
    // 1536 es la dimensión de los embeddings de OpenAI (text-embedding-3-small)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[1536]
      )
    `);
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];

    if (!columns.some((existing) => existing.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  getDb(): Database.Database {
    return this.db;
  }
}
