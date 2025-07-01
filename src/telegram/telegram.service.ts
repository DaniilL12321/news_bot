import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Telegraf, Markup } from 'telegraf';
import { Subscriber } from './entities/subscriber.entity';
import { InputMediaPhoto } from 'telegraf/types';
import { News } from '../news/entities/news.entity';
import { Reaction } from '../news/entities/reaction.entity';

@Injectable()
export class TelegramService {
  private bot: Telegraf;
  private readonly logger = new Logger(TelegramService.name);

  private readonly categories = {
    power: 'Отключение электроснабжения',
    water: 'Отключение воды',
    other: 'Прочие новости',
    all: 'Все новости',
  };

  private readonly reactions = {
    '👍': 'like',
    '👎': 'dislike',
    '❤️': 'love',
    '😡': 'angry',
  };

  constructor(
    @InjectRepository(Subscriber)
    private subscriberRepository: Repository<Subscriber>,
    @InjectRepository(News)
    private newsRepository: Repository<News>,
    @InjectRepository(Reaction)
    private reactionRepository: Repository<Reaction>,
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

  private async getReactionButtons(newsId: number, userId: number) {
    const reactions = await this.reactionRepository.find({
      where: { news: { id: newsId } },
      relations: ['news'],
    });

    const userReaction = reactions.find(r => r.telegram_id === userId);
    
    return Object.entries(this.reactions).map(([emoji, type]) => {
      const count = reactions.filter(r => r.reaction_type === type).length;
      const isSelected = userReaction?.reaction_type === type;
      return Markup.button.callback(
        `${emoji} ${count}${isSelected ? ' ✓' : ''}`,
        `react_${newsId}_${type}`
      );
    });
  }

  private async handleReaction(newsId: number, userId: number, reactionType: string) {
    const news = await this.newsRepository.findOne({ where: { id: newsId } });
    if (!news) return;

    let reaction = await this.reactionRepository.findOne({
      where: { news: { id: newsId }, telegram_id: userId },
      relations: ['news'],
    });

    if (reaction) {
      if (reaction.reaction_type === reactionType) {
        await this.reactionRepository.remove(reaction);
      } else {
        reaction.reaction_type = reactionType;
        await this.reactionRepository.save(reaction);
      }
    } else {
      reaction = this.reactionRepository.create({
        news,
        telegram_id: userId,
        reaction_type: reactionType,
      });
      await this.reactionRepository.save(reaction);
    }
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

    this.bot.action(/react_(\d+)_(.+)/, async (ctx) => {
      const newsId = parseInt(ctx.match[1]);
      const reactionType = ctx.match[2];
      const userId = ctx.from.id;

      await this.handleReaction(newsId, userId, reactionType);
      const buttons = await this.getReactionButtons(newsId, userId);
      
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [buttons],
      });
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

  async notifySubscribersWithMedia(
    text: string,
    imageUrls: string[],
    category?: string,
    newsId?: number,
  ): Promise<void> {
    const subscribers = await this.getSubscribers(category);

    for (const chatId of subscribers) {
      try {
        const reactionButtons = newsId ? await this.getReactionButtons(newsId, chatId) : [];
        const keyboard = reactionButtons.length > 0 ? 
          { reply_markup: { inline_keyboard: [reactionButtons] } } : 
          {};

        if (imageUrls.length === 0) {
          await this.bot.telegram.sendMessage(chatId, text, keyboard);
        } else if (imageUrls.length === 1) {
          await this.bot.telegram.sendPhoto(chatId, imageUrls[0], {
            caption: text,
            ...keyboard,
          });
        } else {
          const media: InputMediaPhoto[] = imageUrls.map((url, index) => ({
            type: 'photo',
            media: url,
            caption: index === 0 ? text : undefined,
          }));

          const message = await this.bot.telegram.sendMediaGroup(chatId, media);
          if (reactionButtons.length > 0 && message && message[0]) {
            await this.bot.telegram.sendMessage(chatId, '🔽 Реакции:', keyboard);
          }
        }
      } catch (error) {
        this.logger.error(`Ошибка при отправке сообщения в чат ${chatId}:`, error);
      }
    }
  }

  private async getSubscribers(category: string = 'all'): Promise<number[]> {
    const subscribers = await this.subscriberRepository.find();
    return subscribers
      .filter(sub => sub.categories.includes(category) || sub.categories.includes('all'))
      .map(sub => sub.telegram_id);
  }

  determineCategory(title: string): string {
    title = title.toLowerCase();
    if (title.includes('электроснабжен')) return 'power';
    if (title.includes('вода') || title.includes('водоснабжен')) return 'water';
    return 'other';
  }
}
