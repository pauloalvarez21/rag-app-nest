import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  const service = {
    processAndStoreDocument: jest.fn(),
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
      .uploadDocument(undefined as unknown as Express.Multer.File)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain(
      'Falta el archivo',
    );
    expect(service.processAndStoreDocument).not.toHaveBeenCalled();
  });

  it('devuelve el resultado de la ingesta', async () => {
    service.processAndStoreDocument.mockResolvedValue({
      id: 'documento-pdf',
      chunks: 4,
    });
    const file = {
      originalname: 'documento.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('pdf'),
    } as unknown as Express.Multer.File;

    await expect(controller.uploadDocument(file)).resolves.toEqual({
      message: 'Documento procesado exitosamente',
      documentId: 'documento-pdf',
      chunks: 4,
    });
    expect(service.processAndStoreDocument).toHaveBeenCalledWith(file);
  });

  it('lista los documentos', () => {
    const documents = [{ id: 'documento-pdf' }];
    service.listDocuments.mockReturnValue(documents);

    expect(controller.listDocuments()).toEqual({ documents });
  });
});
