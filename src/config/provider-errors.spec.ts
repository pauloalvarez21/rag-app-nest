import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { toHttpException } from './provider-errors';

const context = {
  provider: 'embeddings (EMBEDDINGS_BASE_URL)',
  modelVar: 'EMBEDDINGS_MODEL',
  apiKeyVar: 'EMBEDDINGS_API_KEY',
  model: 'openai/text-embedding-3-small',
};

describe('toHttpException', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('traduce un modelo inexistente a 502 sin filtrar el detalle', () => {
    const error = toHttpException(
      {
        status: 404,
        code: 'model_not_found',
        message: 'The model `x` does not exist (host interno secreto)',
      },
      context,
    );

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    const body = JSON.stringify(error.getResponse());
    expect(body).toContain('EMBEDDINGS_MODEL');
    expect(body).not.toContain('host interno secreto');
    expect(logSpy).toHaveBeenCalled();
  });

  it('traduce credenciales rechazadas a 502', () => {
    const error = toHttpException({ status: 401 }, context);

    expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(JSON.stringify(error.getResponse())).toContain('EMBEDDINGS_API_KEY');
  });

  it('devuelve el mismo HttpException si ya lo es', () => {
    const original = new HttpException('teapot', 418);
    expect(toHttpException(original, context)).toBe(original);
  });
});
