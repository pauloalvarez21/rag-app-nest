import { FileType } from '../file-types';
import { DocxTextExtractor } from './docx-text.extractor';
import { HtmlTextExtractor } from './html-text.extractor';
import { PdfTextExtractor } from './pdf-text.extractor';
import { PlainTextExtractor } from './plain-text.extractor';
import { TextExtractor } from './text-extractor';

const plainText = new PlainTextExtractor();

const EXTRACTORS: Record<FileType, TextExtractor> = {
  pdf: new PdfTextExtractor(),
  docx: new DocxTextExtractor(),
  txt: plainText,
  md: plainText,
  csv: plainText,
  html: new HtmlTextExtractor(),
};

export function extractText(type: FileType, buffer: Buffer): Promise<string> {
  return EXTRACTORS[type].extract(buffer);
}
