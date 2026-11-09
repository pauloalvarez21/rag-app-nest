import { convert } from 'html-to-text';
import { TextExtractor } from './text-extractor';

export class HtmlTextExtractor implements TextExtractor {
  extract(buffer: Buffer): Promise<string> {
    const text = convert(buffer.toString('utf8'), {
      wordwrap: false,
      selectors: [
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        // Conserva el texto tal cual: las mayúsculas por defecto de los
        // encabezados alteran el contenido original que se indexa.
        ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({
          selector,
          options: { uppercase: false },
        })),
      ],
    });

    return Promise.resolve(text);
  }
}
