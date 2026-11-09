import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import { FileValidationService } from './file-validation.service';

function fakeConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

function uploadFile(
  buffer: Buffer,
  originalname: string,
  mimetype = 'application/octet-stream',
): Express.Multer.File {
  return {
    originalname,
    buffer,
    mimetype,
    size: buffer.length,
  } as unknown as Express.Multer.File;
}

function contentTypes(withWordprocessing = true): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (withWordprocessing
      ? '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      : '') +
    '</Types>'
  );
}

async function zipFile(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }

  return zip.generateAsync<'nodebuffer'>({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
}

function docx(extra: Record<string, string> = {}): Promise<Buffer> {
  return zipFile({
    '[Content_Types].xml': contentTypes(),
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>hola</w:t></w:r></w:p></w:body></w:document>',
    ...extra,
  });
}

function createService(overrides: Record<string, string> = {}) {
  return new FileValidationService(
    fakeConfig({
      ALLOWED_FILE_TYPES: 'pdf,docx,txt,md,html,csv',
      MAX_FILE_SIZE_MB: '10',
      MAX_UNCOMPRESSED_MB: '50',
      ...overrides,
    }),
  );
}

describe('FileValidationService', () => {
  it('acepta PDF, DOCX, TXT, MD, HTML y CSV', async () => {
    const service = createService();

    await expect(
      service.validate(
        uploadFile(Buffer.from('%PDF-1.4\ncontenido'), 'doc.pdf'),
      ),
    ).resolves.toMatchObject({ type: 'pdf', extension: 'pdf' });

    await expect(
      service.validate(uploadFile(await docx(), 'doc.docx')),
    ).resolves.toMatchObject({ type: 'docx', extension: 'docx' });

    await expect(
      service.validate(uploadFile(Buffer.from('texto'), 'notas.txt')),
    ).resolves.toMatchObject({ type: 'txt', mimeType: 'text/plain' });

    await expect(
      service.validate(uploadFile(Buffer.from('# titulo'), 'README.md')),
    ).resolves.toMatchObject({ type: 'md' });

    await expect(
      service.validate(uploadFile(Buffer.from('<p>hola</p>'), 'pagina.htm')),
    ).resolves.toMatchObject({ type: 'html', extension: 'html' });

    await expect(
      service.validate(uploadFile(Buffer.from('a,b\n1,2'), 'datos.csv')),
    ).resolves.toMatchObject({ type: 'csv' });
  });

  it('rechaza extensiones fuera de la allowlist', async () => {
    const error = await createService()
      .validate(uploadFile(Buffer.from('MZ'), 'programa.exe'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain(
      'no es un tipo de archivo permitido',
    );
  });

  it('rechaza un PDF sin la firma %PDF-', async () => {
    const error = await createService()
      .validate(uploadFile(Buffer.from('no soy pdf'), 'falso.pdf'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain('dañado');
  });

  it('rechaza texto que no es UTF-8 válido', async () => {
    const error = await createService()
      .validate(uploadFile(Buffer.from([0x68, 0x00, 0x69]), 'binario.txt'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain(
      'no parece texto UTF-8',
    );
  });

  it('rechaza archivos que superan el tamaño máximo', async () => {
    const service = createService({ MAX_FILE_SIZE_MB: '0.0001' });
    const error = await service
      .validate(uploadFile(Buffer.from('x'.repeat(200)), 'grande.txt'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain(
      'supera el máximo',
    );
  });

  it('rechaza un DOCX que se expande demasiado (zip bomb)', async () => {
    const service = createService({ MAX_UNCOMPRESSED_MB: '0.001' });
    const buffer = await docx({ 'relleno.txt': '0'.repeat(5000) });

    const error = await service
      .validate(uploadFile(buffer, 'bomba.docx'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain('zip bomb');
  });

  it('rechaza un ZIP que no es DOCX', async () => {
    const buffer = await zipFile({
      '[Content_Types].xml': contentTypes(false),
      'otro.txt': 'hola',
    });

    const error = await createService()
      .validate(uploadFile(buffer, 'falso.docx'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain(
      'no es un DOCX válido',
    );
  });

  it('rechaza nombres con rutas (path traversal)', async () => {
    const error = await createService()
      .validate(uploadFile(Buffer.from('texto'), '../evil.txt'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain('no es válido');
  });
});
