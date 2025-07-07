import { Injectable } from '@nestjs/common';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class AdminService {
  constructor(private readonly telegramService: TelegramService) {}

  async sendCustomMessage(
    message: string,
    category?: string,
    imageUrls: string[] = []
  ) {
    const result = await this.telegramService.notifySubscribersWithMedia(
      message,
      imageUrls,
      category
    );
    return result;
  }
} 