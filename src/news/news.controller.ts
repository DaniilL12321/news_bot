import { Controller, Get, Query } from '@nestjs/common';
import { NewsService } from './news.service';

@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get('fetch-historical')
  async fetchHistoricalNews(
    @Query('startPage') startPage?: number,
    @Query('endPage') endPage?: number,
  ) {
    await this.newsService.fetchAllHistoricalNews(
      startPage ? Number(startPage) : 1,
      endPage ? Number(endPage) : 163
    );
    return { message: 'Процесс сбора исторических новостей выполнен' };
  }
} 