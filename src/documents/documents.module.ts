import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { DirectoryIngestorService } from './directory-ingestor.service';
import { FileValidationService } from './file-validation.service';
import { toBytes } from './file-types';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: toBytes(config.get<string>('MAX_FILE_SIZE_MB'), 10),
        },
      }),
    }),
  ],
  providers: [
    DocumentsService,
    DirectoryIngestorService,
    FileValidationService,
  ],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
