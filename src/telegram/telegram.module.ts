import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service';
import { Subscriber } from './entities/subscriber.entity';
import { News } from '../news/entities/news.entity';
import { Reaction } from '../news/entities/reaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Subscriber, News, Reaction])],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
