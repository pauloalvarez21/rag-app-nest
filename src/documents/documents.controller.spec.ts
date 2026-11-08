import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  const service = {
    processAndStorePDF: jest.fn(),
    listDocuments: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [{ provide: DocumentsService, useValue: service }],
    }).compile();

    controller = module.get<DocumentsController>(DocumentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('rechaza la petición si falta el archivo', async () => {
    const error = await controller
      .uploadPDF(undefined as unknown as Express.Multer.File)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain(
      'Falta el archivo',
    );
    expect(service.processAndStorePDF).not.toHaveBeenCalled();
  });

  it('rechaza archivos que no son PDF', async () => {
    const file = {
      originalname: 'notas.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from('texto'),
    } as unknown as Express.Multer.File;

    const error = await controller.uploadPDF(file).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain('no es un PDF');
    expect(service.processAndStorePDF).not.toHaveBeenCalled();
  });

  it('devuelve el resultado de la ingesta', async () => {
    service.processAndStorePDF.mockResolvedValue({
      id: 'documento',
      chunks: 4,
    });
    const file = {
      originalname: 'documento.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('pdf'),
    } as unknown as Express.Multer.File;

    await expect(controller.uploadPDF(file)).resolves.toEqual({
      message: 'PDF procesado exitosamente',
      documentId: 'documento',
      chunks: 4,
    });
    expect(service.processAndStorePDF).toHaveBeenCalledWith(file);
  });

  it('lista los documentos', () => {
    const documents = [{ id: 'documento' }];
    service.listDocuments.mockReturnValue(documents);

    expect(controller.listDocuments()).toEqual({ documents });
  });
});
