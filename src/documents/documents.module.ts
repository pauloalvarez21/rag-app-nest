import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { DirectoryIngestorService } from './directory-ingestor.service';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB máximo
      },
    }),
  ],
  providers: [DocumentsService, DirectoryIngestorService],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
