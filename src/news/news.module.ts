import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NewsService } from './news.service';
import { News } from './entities/news.entity';
import { Reaction } from './entities/reaction.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { BackupService } from '../backup/backup.service';
import { NewsController } from './news.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([News, Reaction]),
    TelegramModule,
  ],
  controllers: [NewsController],
  providers: [
    NewsService,
    BackupService,
  ],
  exports: [NewsService],
})
export class NewsModule {}
