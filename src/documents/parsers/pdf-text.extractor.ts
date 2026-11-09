import { PDFParse } from 'pdf-parse';
import { TextExtractor } from './text-extractor';

export class PdfTextExtractor implements TextExtractor {
  async extract(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });

    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
}
