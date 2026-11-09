import { TextExtractor } from './text-extractor';

export class PlainTextExtractor implements TextExtractor {
  extract(buffer: Buffer): Promise<string> {
    return Promise.resolve(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  }
}
