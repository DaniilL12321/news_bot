import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NewsService } from './news.service';
import { News } from './entities/news.entity';
import { Reaction } from './entities/reaction.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { BackupService } from '../backup/backup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([News, Reaction]),
    TelegramModule,
  ],
  providers: [
    NewsService,
    BackupService,
  ],
  exports: [NewsService],
})
export class NewsModule {}
