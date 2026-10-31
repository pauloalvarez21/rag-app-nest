import { HttpException, HttpStatus } from '@nestjs/common';

interface ProviderErrorContext {
  /** Etiqueta del proveedor, p. ej. "embeddings (EMBEDDINGS_BASE_URL)". */
  provider: string;
  /** Variable de entorno del modelo, para indicar qué revisar. */
  modelVar: string;
  /** Variable de entorno de la clave, para indicar qué revisar. */
  apiKeyVar: string;
  /** Modelo solicitado, si se conoce. */
  model?: string;
}

/**
 * Traduce los errores de los SDK de chat/embeddings a respuestas HTTP claras.
 *
 * Los casos reales que evita:
 * - 404 `model_not_found`: el modelo no existe en ese proveedor (típico cuando
 *   los embeddings apuntan al proveedor de chat, que no los ofrece).
 * - 401/403: la API key no vale para ese proveedor.
 */
export function toHttpException(
  error: unknown,
  ctx: ProviderErrorContext,
): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  const err = error as {
    status?: number;
    code?: string;
    message?: string;
  };
  const detail = err?.message ?? String(error);

  // Cada proveedor lo devuelve distinto: OpenAI/Groq usan 404 + model_not_found,
  // OpenRouter responde 400 con "Model X does not exist".
  const isModelError =
    err?.status === 404 ||
    err?.code === 'model_not_found' ||
    /model.*(does not exist|not found|not supported|invalid)/i.test(detail);

  if (isModelError) {
    return new HttpException(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        error: 'Modelo no disponible en el proveedor',
        message:
          `El proveedor de ${ctx.provider} no reconoce el modelo ` +
          `"${ctx.model ?? '(no configurado)'}". Revisa ${ctx.modelVar} en tu .env ` +
          `y comprueba que el proveedor de ${ctx.provider} sirva ese modelo.`,
        detail,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }

  if (err?.status === 401 || err?.status === 403 || err?.code === 'invalid_api_key') {
    return new HttpException(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        error: 'Credenciales rechazadas',
        message:
          `El proveedor de ${ctx.provider} rechazó la API key. Revisa ${ctx.apiKeyVar} ` +
          `en tu .env: debe ser una clave del proveedor de ${ctx.provider}, no de otro.`,
        detail,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }

  return new HttpException(
    {
      statusCode: HttpStatus.BAD_GATEWAY,
      error: 'Error del proveedor',
      message: `Falló la llamada al proveedor de ${ctx.provider}.`,
      detail,
    },
    HttpStatus.BAD_GATEWAY,
  );
}
