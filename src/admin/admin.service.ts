import { Injectable } from '@nestjs/common';
import { TelegramService } from '../telegram/telegram.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { News } from '../news/entities/news.entity';

@Injectable()
export class AdminService {
  private lastAdminNewsId = 0;

  constructor(
    private readonly telegramService: TelegramService,
    @InjectRepository(News)
    private readonly newsRepository: Repository<News>,
  ) {
    this.initLastAdminNewsId();
  }

  private async initLastAdminNewsId() {
    const lastNews = await this.newsRepository.findOne({
      where: { external_id: -1 },
      order: { external_id: 'ASC' }
    });
    
    if (lastNews) {
      this.lastAdminNewsId = Math.abs(lastNews.external_id);
    }
  }

  private async getNextAdminNewsId(): Promise<number> {
    this.lastAdminNewsId++;
    return -this.lastAdminNewsId;
  }

  async sendCustomMessage(
    message: string,
    category?: string,
    imageUrls: string[] = [],
    saveToDatabase: boolean = false
  ) {
    let newsId: number | undefined;

    if (saveToDatabase) {
      const external_id = await this.getNextAdminNewsId();
      const news = await this.newsRepository.save({
        external_id,
        title: message.split('\n')[0] || 'Сообщение из админ-панели',
        content: message + (imageUrls.length > 0 ? '\n\n📷 Изображения:\n' + imageUrls.join('\n') : ''),
        link: process.env.ADMIN_PANEL_URL || 'http://localhost:3000',
        date: new Date(),
      });
      newsId = news.id;
    }

    const result = await this.telegramService.notifySubscribersWithMedia(
      message,
      imageUrls,
      category,
      newsId
    );
    return result;
  }
} 