import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { News } from './entities/news.entity';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(
    @InjectRepository(News)
    private newsRepository: Repository<News>,
    private telegramService: TelegramService,
  ) {}

  @Cron('*/1 * * * *')
  async checkNews() {
    try {
      const response = await axios.get('https://nerehta-adm.ru/news');
      const $ = cheerio.load(response.data);

      const newsItems = $('.list-item')
        .map((_, element) => {
          const linkElement = $(element).find('.caption a.item');
          const link = linkElement.attr('href');
          const title = linkElement.text().replace(/\s+/g, ' ').trim();
          const dateStr = $(element).find('.date').text().trim();

          if (!link) {
            return null;
          }

          const external_id = parseInt(link.split('/').pop() || '0');

          const [day, month, year] = dateStr.split('.');
          const date = new Date(
            parseInt(`20${year}`), 
            parseInt(month) - 1, 
            parseInt(day)
          );

          if (isNaN(date.getTime())) {
            this.logger.warn(`Некорректная дата для новости: ${dateStr}`);
            return null;
          }

          return {
            external_id,
            title,
            link,
            date,
          };
        })
        .get()
        .filter((item) => item !== null);

      for (const item of newsItems) {
        try {
          const exists = await this.newsRepository.findOne({
            where: { external_id: item.external_id },
          });

          if (!exists && item.link) {
            const newsContent = await this.getNewsContent(item.link);
            try {
              const news = await this.newsRepository.save({
                ...item,
                content: newsContent,
              });

              await this.telegramService.notifySubscribers(
                `🔔 Новая новость!\n\n${item.title}\n\n${newsContent}`,
              );
            } catch (saveError: any) {
              if (saveError?.driverError?.code !== '23505') {
                throw saveError;
              }
              this.logger.debug(
                `Новость с external_id ${item.external_id} уже существует`,
              );
            }
          }
        } catch (itemError) {
          this.logger.error(
            `Ошибка при обработке новости ${item.external_id}:`,
            itemError,
          );
        }
      }
    } catch (error) {
      this.logger.error('Ошибка при парсинге новостей:', error);
    }
  }

  private async getNewsContent(url: string): Promise<string> {
    try {
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);

      const description = $('.description');
      let content = '';

      if (description.children('p').length === 0) {
        let text = description.html() || '';
        
        text = text
          .replace(/<br\s*\/?>\s*<br\s*\/?>/g, '\n\n')
          .replace(/<br\s*\/?>/g, '\n')
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\n\s*\n/g, '\n\n')
          .replace(/;\- /gm, '• \n')
          .replace(/;\-/gm, '• \n')
          .replace(/- /gm, '• ')
          .replace(/^-/gm, '• ')
          .trim();

        content = text;
      } else {
        const textContainers = description.find('p');
        
        textContainers.each((_, element) => {
          let text = $(element).text()
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/<br\s*\/?>/g, '\n')
            .trim();

          if (text) {
            text = text
              .replace(/<br\s*\/?>/g, '\n')

              .replace(/;\- /gm, '\n• ')
              .replace(/;\-/gm, '\n• ')
              .replace(/- /gm, '• ')
              .replace(/^-/gm, '• ')
              .trim();

            content += text + '\n\n';
          }
        });
      }

      const uniqueLines = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n\n') + `\n\n📎 Новость на оф.сайте: ${url}`;

      return uniqueLines;
    } catch (error) {
      this.logger.error(
        `Ошибка при получении содержания новости: ${url}`,
        error,
      );
      return '';
    }
  }
}
