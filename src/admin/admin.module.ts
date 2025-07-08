import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { TelegramModule } from '../telegram/telegram.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { News } from '../news/entities/news.entity';

@Module({
  imports: [
    TelegramModule,
    TypeOrmModule.forFeature([News])
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {} 