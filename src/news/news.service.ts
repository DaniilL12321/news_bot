import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { News } from './entities/news.entity';
import { TelegramService } from '../telegram/telegram.service';
import { BackupService } from '../backup/backup.service';

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);
  private readonly SUMMARY_API_URL = process.env.SUMMARY_API_URL;
  private readonly FORMAT_API_URL = process.env.FORMAT_API_URL;
  private readonly MAX_TELEGRAM_LENGTH = 1024;

  constructor(
    @InjectRepository(News)
    private newsRepository: Repository<News>,
    private telegramService: TelegramService,
    private backupService: BackupService,
  ) {
    if (!this.SUMMARY_API_URL) {
      this.logger.warn('SUMMARY_API_URL не задан в конфигурации');
    }
    if (!this.FORMAT_API_URL) {
      this.logger.warn('FORMAT_API_URL не задан в конфигурации');
    }
  }

  private prepareHtmlForJson(html: string): string {
    let cleanHtml = html
      .replace(/\s+class="[^"]*"/g, '')
      .replace(/\s+id="[^"]*"/g, '')
      .replace(/\s+data-[^=]*="[^"]*"/g, '')
      .replace(/<div[^>]*>/g, '<div>')
      .replace(/\s+style="[^"]*"/g, '')
      .replace(/\s+title="[^"]*"/g, '')
      .replace(/\s+tabindex="[^"]*"/g, '')
      .replace(/\s+href="[^"]*"/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ');

    cleanHtml = cleanHtml
      .replace(/<div>\s*<\/div>/g, '')
      .replace(/<div>\s*<br>\s*<\/div>/g, '<br>');

    const jsonSafeHtml = cleanHtml
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f');

    return jsonSafeHtml;
  }

  private async formatHtmlContent(html: string): Promise<string> {
    if (!this.FORMAT_API_URL) {
      return html;
    }

    try {
      console.log(`🔄 Отправка запроса на API форматирования: ${this.FORMAT_API_URL}`);
      console.log('Исходный HTML для подготовки: ', html);
      const jsonText = this.prepareHtmlForJson(html);
      console.log('Подготовленный HTML: ', jsonText);
      const response = await axios.post(this.FORMAT_API_URL, {
        text: jsonText
      });
      
      console.log('📥 Ответ от API форматирования:', response.data);
      
      if (response.data && response.data.summary) {
        console.log('✅ Получен отформатированный текст от API');
        return response.data.summary;
      }
      
      console.log('⚠️ API форматирования не вернула отформатированный текст в поле summary');
      return html;
    } catch (error) {
      this.logger.error('Ошибка при форматировании HTML:', error);
      return html;
    }
  }

  private async getShortenedText(text: string): Promise<{ text: string; wasShortened: boolean }> {
    if (!this.SUMMARY_API_URL) {
      return {
        text: text.length > this.MAX_TELEGRAM_LENGTH ? 
          text.substring(0, this.MAX_TELEGRAM_LENGTH - 3) + '...' : 
          text,
        wasShortened: false
      };
    }

    if (text.length <= this.MAX_TELEGRAM_LENGTH) {
      return {
        text: text,
        wasShortened: false
      };
    }

    try {
      console.log(`📝 Отправка запроса на API сокращения: ${this.SUMMARY_API_URL}`);
      const response = await axios.post(this.SUMMARY_API_URL, {
        text: text
      });
      
      if (response.data && response.data.summary) {
        console.log('✅ Получен сокращенный текст от API');
        return { 
          text: response.data.summary,
          wasShortened: true 
        };
      }
      
      console.log('⚠️ API сокращения не вернула сокращенный текст');
      return { 
        text: text.substring(0, this.MAX_TELEGRAM_LENGTH - 3) + '...',
        wasShortened: false 
      };
    } catch (error) {
      this.logger.error('Ошибка при сокращении текста:', error);
      return { 
        text: text.substring(0, this.MAX_TELEGRAM_LENGTH - 3) + '...',
        wasShortened: false 
      };
    }
  }

  private formatRegularContent(description: cheerio.Cheerio<any>): string {
    let content = '';

    if (description.children('p').length === 0) {
      let text = description.html() || '';

      text = text
        .replace(/<br\s*\/?>|<BR\s*\/?>/gi, '\n')
        .replace(/\n\s*\n/g, '\n\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/,\s*\n/g, ', ')
        .replace(/;\- /gm, '• \n')
        .replace(/;\-/gm, '• \n')
        .replace(/- /gm, '• ')
        .replace(/^-/gm, '• ')
        .trim();

      content = text;
    } else {
      const textContainers = description.find('p');

      textContainers.each((_, element) => {
        let text = cheerio.load(element).html() || '';
        
        text = text
          .replace(/<br\s*\/?>|<BR\s*\/?>/gi, '\n')
          .replace(/\n\s*\n/g, '\n\n')
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/,\s*\n/g, ', ')
          .replace(/;\- /gm, '\n• ')
          .replace(/;\-/gm, '\n• ')
          .replace(/- /gm, '\n• ')
          .replace(/^-/gm, '\n• ')
          .trim();

        if (text) {
          content += text + '\n\n';
        }
      });
    }

    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n\n');
  }

  private isUtilityNews(title: string): boolean {
    const lowerTitle = title.toLowerCase();
    return lowerTitle.includes('электроснабжен') || 
           lowerTitle.includes('вода') || 
           lowerTitle.includes('водоснабжен') ||
           lowerTitle.includes('отключени') ||
           lowerTitle.includes('об отключени');
  }

  private async getNewsContent(url: string, title: string): Promise<{ content: string; rawHtml: string; imageUrls: string[] }> {
    try {
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      const description = $('.description');
      
      const imageUrls = $('a[rel="images-gallery"]')
        .map((_, element) => $(element).attr('href'))
        .get()
        .filter(link => link);

      const isUtility = this.isUtilityNews(title);
      let content: string;
      let rawHtml = description.html() || '';

      if (isUtility) {
        content = await this.formatHtmlContent(rawHtml);
      } else {
        content = this.formatRegularContent(description);
      }

      return {
        content,
        rawHtml,
        imageUrls
      };
    } catch (error) {
      this.logger.error(
        `Ошибка при получении содержания новости: ${url}`,
        error,
      );
      return { content: '', rawHtml: '', imageUrls: [] };
    }
  }

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
            parseInt(day),
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
            const { content, rawHtml, imageUrls } = await this.getNewsContent(item.link, item.title);
            
            try {
              const category = this.determineCategory(item.title);
              const isUtility = this.isUtilityNews(item.title);

              let processedContent: string;
              let wasShortened = false;

              if (isUtility) {
                processedContent = content;
              } else if (content.length > this.MAX_TELEGRAM_LENGTH) {
                const shortened = await this.getShortenedText(content);
                processedContent = shortened.text;
                wasShortened = shortened.wasShortened;
              } else {
                processedContent = content;
              }

              const news = await this.newsRepository.save({
                ...item,
                content: processedContent + (imageUrls.length > 0 ? '\n\n📷 Изображения:\n' + imageUrls.join('\n') : ''),
              });

              await this.backupService.createBackup();

              const aiNote = wasShortened ? '\n\n💡 Текст сокращён нейросетью' : '';
              const message = `🔔 Новая новость!\n\n${item.title}\n\n${processedContent}${aiNote}\n\n📎 Новость на оф.сайте: ${item.link}`;

              this.logger.log(`Отправка новости "${item.title}" подписчикам. Категория: ${category}`);
              
              await this.telegramService.notifySubscribersWithMedia(
                message,
                imageUrls,
                category,
                news.id
              );

              this.logger.log(`Новость успешно отправлена подписчикам: ${item.title}`);

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

  private determineCategory(title: string): string {
    const lowerTitle = title.toLowerCase();
    
    if (lowerTitle.includes('электроснабжен')) {
      return 'power';
    }
    
    if (lowerTitle.includes('вода') || lowerTitle.includes('водоснабжен')) {
      return 'water';
    }
    
    return 'general';
  }

  async fetchAllHistoricalNews(startPage: number = 1, endPage: number = 163) {
    this.logger.log(`Начинаю сбор исторических новостей со страницы ${startPage} по ${endPage}`);
    
    for (let page = startPage; page <= endPage; page++) {
      try {
        const url = `https://nerehta-adm.ru/news/index/MNews_page/${page}`;
        this.logger.log(`Обработка страницы ${page}: ${url}`);
        
        const response = await axios.get(url);
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
              parseInt(day),
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
              const { content, rawHtml, imageUrls } = await this.getNewsContent(item.link, item.title);
              
              try {
                const isUtility = this.isUtilityNews(item.title);
                
                let processedContent: string;
                let wasShortened = false;

                if (isUtility) {
                  processedContent = content;
                } else if (content.length > this.MAX_TELEGRAM_LENGTH) {
                  const shortened = await this.getShortenedText(content);
                  processedContent = shortened.text;
                  wasShortened = shortened.wasShortened;
                } else {
                  processedContent = content;
                }

                const finalContent = processedContent + (imageUrls.length > 0 ? '\n\n📷 Изображения:\n' + imageUrls.join('\n') : '');

                await this.newsRepository.save({
                  ...item,
                  content: finalContent,
                });

                this.logger.log(`Сохранена историческая новость: ${item.title}`);

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
              `Ошибка при обработке исторической новости ${item.external_id}:`,
              itemError,
            );
          }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        this.logger.error(`Ошибка при обработке страницы ${page}:`, error);
      }
    }
    
    this.logger.log('Сбор исторических новостей завершен');
  }
}
