import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';

/**
 * Dimensión de la columna `vec_chunks.embedding` (FLOAT[1536]) definida en
 * database.service.ts. Si cambias de modelo de embeddings por uno de otra
 * dimensión, hay que cambiar la tabla y reindexar.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Crea el cliente de embeddings a partir de las variables EMBEDDINGS_*.
 *
 * El proveedor de chat (Groq) no tiene endpoint de embeddings, así que este
 * cliente debe apuntar a otro proveedor. El baseURL se pasa siempre explícito:
 * si se omite, el SDK de openai hereda OPENAI_BASE_URL del entorno y las
 * peticiones acaban en el proveedor de chat.
 */
export function createEmbeddings(
  configService: ConfigService,
): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    apiKey: configService.getOrThrow<string>('EMBEDDINGS_API_KEY'),
    model:
      configService.get<string>('EMBEDDINGS_MODEL') ??
      'openai/text-embedding-3-small',
    configuration: {
      baseURL: configService.getOrThrow<string>('EMBEDDINGS_BASE_URL'),
    },
  });
}

/**
 * Comprueba que el vector tenga la dimensión que espera la tabla `vec_chunks`.
 * Sin esta comprobación, un modelo de otra dimensión falla al insertar con un
 * error de sqlite-vec poco descriptivo ("Dimension mismatch").
 */
export function assertEmbeddingDimensions(vector: number[], model: string): void {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new InternalServerErrorException(
      `El modelo de embeddings "${model}" devolvió ${vector.length} dimensiones, ` +
        `pero la tabla vec_chunks espera FLOAT[${EMBEDDING_DIMENSIONS}]. ` +
        `Usa un modelo de ${EMBEDDING_DIMENSIONS} dimensiones (por ejemplo ` +
        `openai/text-embedding-3-small) o cambia EMBEDDING_DIMENSIONS, la tabla y reindexa.`,
    );
  }
}
