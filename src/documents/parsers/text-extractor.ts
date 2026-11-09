export interface TextExtractor {
  extract(buffer: Buffer): Promise<string>;
}
