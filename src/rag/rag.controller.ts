import { Controller, Post, Body } from '@nestjs/common';
import { RagService } from './rag.service';
import { AskQuestionDto } from './dto/ask-question.dto';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('ask')
  async askQuestion(@Body() body: AskQuestionDto) {
    return this.ragService.askQuestion(body.question);
  }
}
