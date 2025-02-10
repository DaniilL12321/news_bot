import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Telegraf } from 'telegraf';
import { Subscriber } from './entities/subscriber.entity';

@Injectable()
export class TelegramService {
  private bot: Telegraf;
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @InjectRepository(Subscriber)
    private subscriberRepository: Repository<Subscriber>,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error(
        'TELEGRAM_BOT_TOKEN не установлен в переменных окружения',
      );
    }
    this.bot = new Telegraf(token);
    this.initializeBot();
  }

  private initializeBot() {
    this.bot.command('start', async (ctx) => {
      const telegram_id = ctx.from.id;

      const subscriber = await this.subscriberRepository.findOne({
        where: { telegram_id },
      });

      const welcomeMessage =
        '👋 Добро пожаловать в бота новостей города Нерехта!\n\n' +
        'Этот бот будет присылать вам уведомления о новых новостях с официального сайта администрации\n\n' +
        'Доступные команды:\n' +
        '• /subscribe - Подписаться на уведомления\n' +
        '• /unsubscribe - Отписаться от уведомлений\n' +
        '• /about - Информация о боте\n\n' +
        'Разработчик: @danya_lobanov\n' +
        'Исходный код: https://github.com/DaniilL12321/news_bot';

      await ctx.reply(welcomeMessage);
    });

    this.bot.command('subscribe', async (ctx) => {
      const telegram_id = ctx.from.id;

      const subscriber = await this.subscriberRepository.findOne({
        where: { telegram_id },
      });

      if (!subscriber) {
        await this.subscriberRepository.save({ telegram_id });
        ctx.reply('✅ Вы успешно подписались на рассылку новостей!');
      } else {
        ctx.reply('ℹ️ Вы уже подписаны на рассылку новостей');
      }
    });

    this.bot.command('unsubscribe', async (ctx) => {
      const telegram_id = ctx.from.id;
      await this.subscriberRepository.delete({ telegram_id });
      ctx.reply('🔕 Вы отписались от рассылки новостей.');
    });

    this.bot.command('about', async (ctx) => {
      const aboutMessage =
        '📱 Бот новостей города Нерехта\n\n' +
        'Версия: 1.0.0\n' +
        'Разработчик: @danya_lobanov\n\n' +
        'Бот автоматически отслеживает новости на официальном сайте администрации города ' +
        'и отправляет их подписчикам.\n\n' +
        'GitHub: https://github.com/DaniilL12321';

      await ctx.reply(aboutMessage);
    });

    this.bot.launch();
  }

  async notifySubscribers(message: string) {
    const subscribers = await this.subscriberRepository.find();

    for (const subscriber of subscribers) {
      try {
        await this.bot.telegram.sendMessage(subscriber.telegram_id, message);
      } catch (error) {
        this.logger.error(
          `Ошибка при отправке сообщения подписчику ${subscriber.telegram_id}:`,
          error,
        );
      }
    }
  }
}
