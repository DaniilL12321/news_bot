import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Telegraf, Markup } from 'telegraf';
import { Subscriber } from './entities/subscriber.entity';

@Injectable()
export class TelegramService {
  private bot: Telegraf;
  private readonly logger = new Logger(TelegramService.name);

  private readonly categories = {
    power: 'Отключение электроснабжения',
    water: 'Отключение воды',
    all: 'Все новости',
  };

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

  private async getCategoryButtons(telegram_id: number) {
    const subscriber = await this.subscriberRepository.findOne({
      where: { telegram_id },
    });

    const subscribedCategories = subscriber?.categories || [];

    return Object.entries(this.categories).map(([key, name]) => {
      const isSubscribed = subscribedCategories.includes(key);
      const emoji = isSubscribed ? '✅' : '❌';
      return Markup.button.callback(`${emoji} ${name}`, `toggle_${key}`);
    });
  }

  private initializeBot() {
    this.bot.command('start', async (ctx) => {
      const welcomeMessage =
        '👋 Добро пожаловать в бота новостей города Нерехта!\n\n' +
        'Этот бот будет присылать вам уведомления о новых новостях с официального сайта администрации\n\n' +
        'Доступные команды:\n' +
        '• /subscribe - Управление подписками\n' +
        '• /about - Информация о боте\n\n' +
        'Разработчик: @danya_lobanov\n' +
        'Исходный код: https://github.com/DaniilL12321/news_bot';

      await ctx.reply(welcomeMessage);
    });

    this.bot.command('subscribe', async (ctx) => {
      const buttons = await this.getCategoryButtons(ctx.from.id);

      await ctx.reply(
        'Управление подписками на категории новостей:\n✅ - включено, ❌ - выключено',
        Markup.inlineKeyboard(buttons, { columns: 1 }),
      );
    });

    this.bot.action(/toggle_(.+)/, async (ctx) => {
      const telegram_id = ctx.from.id;
      const category = ctx.match[1];

      let subscriber = await this.subscriberRepository.findOne({
        where: { telegram_id },
      });

      if (!subscriber) {
        subscriber = await this.subscriberRepository.save({
          telegram_id,
          categories: [category],
        });
      } else {
        const isSubscribed = subscriber.categories.includes(category);

        if (category === 'all') {
          if (isSubscribed) {
            subscriber.categories = [];
            await ctx.answerCbQuery('🔕 Отключены все уведомления');
          } else {
            subscriber.categories = Object.keys(this.categories);
            await ctx.answerCbQuery('🔔 Включены все уведомления');
          }
        } else {
          if (isSubscribed) {
            subscriber.categories = subscriber.categories.filter(
              (cat) => cat !== category,
            );
            subscriber.categories = subscriber.categories.filter(
              (cat) => cat !== 'all',
            );
            await ctx.answerCbQuery(
              `🔕 Отключены уведомления: ${this.categories[category]}`,
            );
          } else {
            subscriber.categories.push(category);
            const allCategoriesExceptAll = Object.keys(this.categories).filter(
              (cat) => cat !== 'all',
            );
            const hasAllCategories = allCategoriesExceptAll.every((cat) =>
              subscriber?.categories.includes(cat),
            );
            if (hasAllCategories) {
              subscriber.categories.push('all');
            }
            await ctx.answerCbQuery(
              `🔔 Включены уведомления: ${this.categories[category]}`,
            );
          }
        }

        await this.subscriberRepository.save(subscriber);
      }

      const buttons = await this.getCategoryButtons(telegram_id);
      await ctx.editMessageReplyMarkup(
        Markup.inlineKeyboard(buttons, { columns: 1 }).reply_markup,
      );
    });

    this.bot.command('about', async (ctx) => {
      const aboutMessage =
        '📱 Бот новостей города Нерехта\n\n' +
        'Версия: 1.0.0\n' +
        'Разработчик: @danya_lobanov\n\n' +
        'Бот автоматически отслеживает новости на официальном сайте администрации ' +
        'и отправляет их подписчикам.\n\n' +
        'GitHub: https://github.com/DaniilL12321';

      await ctx.reply(aboutMessage);
    });

    this.bot.launch();
  }

  async notifySubscribers(message: string, category: string = 'all') {
    const subscribers = await this.subscriberRepository.find();

    for (const subscriber of subscribers) {
      try {
        if (
          subscriber.categories.includes(category) ||
          subscriber.categories.includes('all')
        ) {
          await this.bot.telegram.sendMessage(subscriber.telegram_id, message);
        }
      } catch (error) {
        this.logger.error(
          `Ошибка при отправке сообщения подписчику ${subscriber.telegram_id}:`,
          error,
        );
      }
    }
  }

  determineCategory(title: string): string {
    title = title.toLowerCase();
    if (title.includes('электроснабжен')) return 'power';
    if (title.includes('вода') || title.includes('водоснабжен')) return 'water';
    return 'all';
  }
}
