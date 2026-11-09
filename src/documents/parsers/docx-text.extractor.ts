import * as mammoth from 'mammoth';
import { TextExtractor } from './text-extractor';

export class DocxTextExtractor implements TextExtractor {
  async extract(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
}
