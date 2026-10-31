import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { RagService } from './rag.service';
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

function toBuffer(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

/**
 * Vector unitario tal que su distancia L2 a vecAt(1) = [1, 0, ...] es
 * sqrt(2 - 2x): al elegir distintos x se obtienen distancias conocidas y un
 * orden determinista para el top-k.
 */
function vecAt(x: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = x;
  vector[1] = Math.sqrt(Math.max(0, 1 - x * x));
  return vector;
}

describe('RagService (búsqueda vectorial real con sqlite-vec)', () => {
  let databaseService: DatabaseService;
  let service: RagService;
  let embeddings: { embedQuery: jest.Mock; embedDocuments: jest.Mock };
  let llm: { invoke: jest.Mock };
  let consoleSpy: jest.SpyInstance;

  function seedChunk(options: {
    id: string;
    documentId: string;
    content: string;
    source: string;
    vector: number[];
  }): void {
    const db = databaseService.getDb();
    db.prepare(
      'INSERT OR REPLACE INTO documents (id, filename, filepath) VALUES (?, ?, ?)',
    ).run(options.documentId, options.source, `/tmp/${options.source}`);
    db.prepare(
      'INSERT INTO chunks (id, document_id, content, source) VALUES (?, ?, ?, ?)',
    ).run(options.id, options.documentId, options.content, options.source);
    db.prepare('INSERT INTO vec_chunks (id, embedding) VALUES (?, ?)').run(
      options.id,
      toBuffer(options.vector),
    );
  }

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    databaseService = new DatabaseService(
      fakeConfig({ DATABASE_PATH: ':memory:' }),
    );
    databaseService.onModuleInit();

    service = new RagService(
      fakeConfig({
        OPENAI_API_KEY: 'clave-chat',
        OPENAI_MODEL: 'groq/modelo-de-prueba',
        OPENAI_BASE_URL: 'http://localhost:9999/v1',
        EMBEDDINGS_API_KEY: 'clave-embeddings',
        EMBEDDINGS_BASE_URL: 'http://localhost:9998/v1',
        EMBEDDINGS_MODEL: 'openai/text-embedding-3-small',
      }),
      databaseService,
    );

    embeddings = {
      embedQuery: jest.fn(),
      embedDocuments: jest.fn(),
    };
    llm = {
      invoke: jest.fn().mockResolvedValue({ content: 'respuesta simulada' }),
    };
    (service as unknown as { embeddings: typeof embeddings }).embeddings =
      embeddings;
    (service as unknown as { llm: typeof llm }).llm = llm;
    embeddings.embedQuery.mockResolvedValue(vecAt(1));
  });

  afterEach(() => {
    databaseService.onModuleDestroy();
    consoleSpy.mockRestore();
  });

  it('responde con el chunk más cercano y su fuente', async () => {
    seedChunk({
      id: 'alfa_0',
      documentId: 'alfa',
      content: 'Los satelites de Lumina orbitan la Tierra en 90 minutos.',
      source: 'alfa.pdf',
      vector: vecAt(1),
    });

    const result = await service.askQuestion('¿Cada cuánto orbitan?');

    expect(result.answer).toBe('respuesta simulada');
    expect(result.sources).toEqual(['alfa.pdf']);

    const prompt = llm.invoke.mock.calls[0][0] as string;
    expect(prompt).toContain(
      'Los satelites de Lumina orbitan la Tierra en 90 minutos.',
    );
    expect(prompt).toContain('¿Cada cuánto orbitan?');
  });

  it('ordena por distancia y limita la búsqueda a k = 3', async () => {
    // Distancias a la consulta vecAt(1): sqrt(2-2x) → alfa 0, beta 0.45,
    // gamma 1, delta 1.41, epsilon 1.73. Solo caben las tres primeras.
    const seeds = [
      {
        id: 'a',
        doc: 'alfa',
        source: 'alfa.pdf',
        text: 'contenido alfa',
        x: 1,
      },
      {
        id: 'b',
        doc: 'beta',
        source: 'beta.pdf',
        text: 'contenido beta',
        x: 0.9,
      },
      {
        id: 'c',
        doc: 'gamma',
        source: 'gamma.pdf',
        text: 'contenido gamma',
        x: 0.5,
      },
      {
        id: 'd',
        doc: 'delta',
        source: 'delta.pdf',
        text: 'contenido delta',
        x: 0,
      },
      {
        id: 'e',
        doc: 'epsilon',
        source: 'epsilon.pdf',
        text: 'contenido epsilon',
        x: -0.5,
      },
    ];
    for (const seed of seeds) {
      seedChunk({
        id: `${seed.doc}_0`,
        documentId: seed.doc,
        content: seed.text,
        source: seed.source,
        vector: vecAt(seed.x),
      });
    }
    embeddings.embedQuery.mockResolvedValue(vecAt(1));

    const result = await service.askQuestion('¿Qué contiene?');

    expect(result.sources).toEqual(['alfa.pdf', 'beta.pdf', 'gamma.pdf']);

    const prompt = llm.invoke.mock.calls[0][0] as string;
    // Contexto con los 3 chunks (2 separadores) en orden de cercanía.
    expect(prompt.match(/\n\n---\n\n/g)).toHaveLength(2);
    expect(prompt.indexOf('contenido alfa')).toBeLessThan(
      prompt.indexOf('contenido beta'),
    );
    expect(prompt.indexOf('contenido beta')).toBeLessThan(
      prompt.indexOf('contenido gamma'),
    );
    expect(prompt).not.toContain('contenido delta');
    expect(prompt).not.toContain('contenido epsilon');
  });

  it('sin documentos no responde nada inventado ni llama al LLM', async () => {
    embeddings.embedQuery.mockResolvedValue(vecAt(1));

    const result = await service.askQuestion('¿Hay información?');

    expect(result).toEqual({
      answer: 'No encontré información relevante en los documentos cargados.',
      sources: [],
    });
    expect(llm.invoke).not.toHaveBeenCalled();
  });

  it('traduce el error del proveedor de embeddings a un 502 accionable', async () => {
    embeddings.embedQuery.mockRejectedValueOnce({
      status: 404,
      code: 'model_not_found',
      message: 'The model `x` does not exist or you do not have access to it.',
    });

    const error = await service.askQuestion('¿Algo?').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(502);
    expect(JSON.stringify((error as HttpException).getResponse())).toContain(
      'EMBEDDINGS_MODEL',
    );
  });

  it('traduce el error del proveedor de chat a un 502 accionable', async () => {
    seedChunk({
      id: 'alfa_0',
      documentId: 'alfa',
      content: 'contenido alfa',
      source: 'alfa.pdf',
      vector: vecAt(1),
    });
    embeddings.embedQuery.mockResolvedValue(vecAt(1));
    llm.invoke.mockRejectedValueOnce({
      status: 401,
      message: 'Invalid API Key',
    });

    const error = await service.askQuestion('¿Algo?').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(502);
    expect(JSON.stringify((error as HttpException).getResponse())).toContain(
      'OPENAI_API_KEY',
    );
  });

  it('avisa si la consulta devuelve otra dimensión que la tabla', async () => {
    embeddings.embedQuery.mockResolvedValueOnce(new Array<number>(512).fill(0));

    const error = await service.askQuestion('¿Algo?').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(500);
    const body = JSON.stringify((error as HttpException).getResponse());
    expect(body).toContain('512');
    expect(body).toContain(`FLOAT[${EMBEDDING_DIMENSIONS}]`);
  });
});
