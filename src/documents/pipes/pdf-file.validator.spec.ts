import { PdfFileValidator } from './pdf-file.validator';

function fakeFile(buffer: Buffer): Express.Multer.File {
  return { buffer } as Express.Multer.File;
}

describe('PdfFileValidator', () => {
  const validator = new PdfFileValidator();

  it('acepta un archivo que empieza por %PDF-', () => {
    expect(validator.isValid(fakeFile(Buffer.from('%PDF-1.7 ...')))).toBe(true);
  });

  it('rechaza un archivo sin la firma de PDF', () => {
    expect(validator.isValid(fakeFile(Buffer.from('no soy un pdf')))).toBe(
      false,
    );
  });

  it('rechaza un archivo vacío o ausente', () => {
    expect(validator.isValid(fakeFile(Buffer.alloc(0)))).toBe(false);
    expect(validator.isValid(undefined)).toBe(false);
  });

  it('devuelve un mensaje de error claro', () => {
    expect(validator.buildErrorMessage()).toContain('%PDF-');
  });
});
