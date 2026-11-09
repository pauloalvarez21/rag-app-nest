import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AskQuestionDto } from './ask-question.dto';

async function validatePayload(payload: unknown) {
  const dto = plainToInstance(AskQuestionDto, payload);
  return { dto, errors: await validate(dto) };
}

describe('AskQuestionDto', () => {
  it('acepta una pregunta válida y la recorta', async () => {
    const { dto, errors } = await validatePayload({
      question: '  ¿De qué trata el documento?  ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.question).toBe('¿De qué trata el documento?');
  });

  it.each([{}, { question: '' }, { question: '   ' }, { question: 123 }])(
    'rechaza payloads inválidos: %j',
    async (payload) => {
      const { errors } = await validatePayload(payload);
      expect(errors.length).toBeGreaterThan(0);
    },
  );

  it('rechaza preguntas de más de 2000 caracteres', async () => {
    const { errors } = await validatePayload({ question: 'a'.repeat(2001) });
    expect(errors.length).toBeGreaterThan(0);
  });
});
