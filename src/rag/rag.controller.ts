import { BadRequestException, Controller, Post, Body } from '@nestjs/common';
import { RagService } from './rag.service';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('ask')
  async askQuestion(@Body() body: { question?: string }) {
    if (!body?.question || body.question.trim() === '') {
      throw new BadRequestException(
        'Falta la pregunta: envía un JSON como {"question": "¿De qué trata el documento?"}',
      );
    }

    return this.ragService.askQuestion(body.question);
  }
}
