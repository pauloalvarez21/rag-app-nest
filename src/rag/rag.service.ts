import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { DatabaseService } from '../database/database.service';
import {
  assertEmbeddingDimensions,
  createEmbeddings,
} from '../config/embeddings.config';
import { toHttpException } from '../config/provider-errors';

@Injectable()
export class RagService {
  private llm: ChatOpenAI;
  private llmModel: string;
  private embeddings: OpenAIEmbeddings;
  private embeddingsModel: string;

  constructor(
    private configService: ConfigService,
    private databaseService: DatabaseService,
  ) {
    this.llmModel = this.configService.getOrThrow<string>('OPENAI_MODEL');
    this.embeddingsModel =
      this.configService.get<string>('EMBEDDINGS_MODEL') ??
      'openai/text-embedding-3-small';

    this.llm = new ChatOpenAI({
      apiKey: this.configService.getOrThrow<string>('OPENAI_API_KEY'),
      model: this.llmModel,
      temperature: 0,
      configuration: {
        baseURL: this.configService.getOrThrow<string>('OPENAI_BASE_URL'),
      },
    });

    this.embeddings = createEmbeddings(this.configService);
  }

  async askQuestion(
    question: string,
  ): Promise<{ answer: string; sources: string[] }> {
    const db = this.databaseService.getDb();

    // 1. Generar embedding de la pregunta
    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embeddings.embedQuery(question);
    } catch (error) {
      throw toHttpException(error, {
        provider: 'embeddings (EMBEDDINGS_BASE_URL)',
        modelVar: 'EMBEDDINGS_MODEL',
        apiKeyVar: 'EMBEDDINGS_API_KEY',
        model: this.embeddingsModel,
      });
    }

    assertEmbeddingDimensions(queryEmbedding, this.embeddingsModel);

    const queryBuffer = this.float32ArrayToBuffer(queryEmbedding);

    // 2. Buscar chunks más similares usando sqlite-vec.
    //    vec0 necesita la KNN en subconsulta con `k = ?`: un LIMIT en la
    //    consulta exterior no le llega al índice virtual y falla.
    const results = db
      .prepare(
        `
      SELECT 
        c.content,
        c.source,
        v.distance
      FROM (
        SELECT id, distance
        FROM vec_chunks
        WHERE embedding MATCH ?
          AND k = ?
      ) v
      JOIN chunks c ON c.id = v.id
      ORDER BY v.distance
    `,
      )
      .all(queryBuffer, 3);

    if (results.length === 0) {
      return {
        answer: 'No encontré información relevante en los documentos cargados.',
        sources: [],
      };
    }

    // 3. Extraer contexto y fuentes
    const context = results.map((r: any) => r.content).join('\n\n---\n\n');
    const sources = [...new Set(results.map((r: any) => r.source))];

    // 4. Crear prompt con contexto
    const prompt = `Basándote en el siguiente contexto extraído de documentos, responde la pregunta en español. Si la respuesta no está en el contexto, indícalo claramente.

Contexto:
${context}

Pregunta: ${question}

Respuesta:`;

    // 5. Generar respuesta con el LLM
    let answer: string;
    try {
      const response = await this.llm.invoke(prompt);
      answer = response.content as string;
    } catch (error) {
      throw toHttpException(error, {
        provider: 'chat (OPENAI_BASE_URL)',
        modelVar: 'OPENAI_MODEL',
        apiKeyVar: 'OPENAI_API_KEY',
        model: this.llmModel,
      });
    }

    return {
      answer,
      sources,
    };
  }

  private float32ArrayToBuffer(floatArray: number[]): Buffer {
    const buffer = Buffer.alloc(floatArray.length * 4);
    floatArray.forEach((value, index) => {
      buffer.writeFloatLE(value, index * 4);
    });
    return buffer;
  }
}
