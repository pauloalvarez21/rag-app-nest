import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';

describe('RagController', () => {
  let controller: RagController;
  const service = { askQuestion: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RagController],
      providers: [{ provide: RagService, useValue: service }],
    }).compile();

    controller = module.get<RagController>(RagController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it.each([{}, { question: '' }, { question: '   ' }])(
    'responde 400 con la formato esperado si falta la pregunta: %j',
    async (body) => {
      const error = await controller.askQuestion(body).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toContain(
        'Falta la pregunta',
      );
      expect(service.askQuestion).not.toHaveBeenCalled();
    },
  );

  it('delega la pregunta válida en el servicio', async () => {
    const expected = {
      answer: 'respuesta',
      sources: ['doc.pdf'],
    };
    service.askQuestion.mockResolvedValue(expected);

    await expect(
      controller.askQuestion({ question: '¿De qué trata?' }),
    ).resolves.toEqual(expected);
    expect(service.askQuestion).toHaveBeenCalledWith('¿De qué trata?');
  });
});
