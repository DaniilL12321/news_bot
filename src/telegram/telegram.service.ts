import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Telegraf, Markup, Context } from 'telegraf';
import { Subscriber } from './entities/subscriber.entity';
import { InputMediaPhoto, Message } from 'telegraf/types';
import { News } from '../news/entities/news.entity';
import { Reaction } from '../news/entities/reaction.entity';
import axios from 'axios';

interface NominatimAddress {
  road?: string;
  house_number?: string;
  suburb?: string;
  neighbourhood?: string;
  residential?: string;
  city?: string;
  town?: string;
  village?: string;
  [key: string]: string | undefined;
}

interface NominatimResponse {
  address: NominatimAddress;
}

@Injectable()
export class TelegramService {
  private bot: Telegraf;
  private readonly logger = new Logger(TelegramService.name);
  private lastMenuMessageId: { [key: number]: number } = {};
  private userMessageIds: { [key: number]: number[] } = {};
  private lastNominatimRequest: number = 0;

  private readonly categories = {
    power: 'Отключение электроснабжения',
    water: 'Отключение воды',
    events: 'Мероприятия',
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

  private async trackUserMessage(ctx: Context) {
    const chatId = ctx.chat?.id;
    const messageId = ctx.message?.message_id;
    
    if (chatId && messageId) {
      if (!this.userMessageIds[chatId]) {
        this.userMessageIds[chatId] = [];
      }
      this.userMessageIds[chatId].push(messageId);
    }
  }

  private async cleanupUserMessages(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId || !this.userMessageIds[chatId]) return;

    for (const messageId of this.userMessageIds[chatId]) {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
      } catch (error) {
        this.logger.warn(`Не удалось удалить сообщение ${messageId}`);
      }
    }
    this.userMessageIds[chatId] = [];
  }

  private async updateMenuMessage(ctx: Context, text: string, keyboard: any) {
    try {
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      await this.cleanupUserMessages(ctx);

      if (this.lastMenuMessageId[chatId]) {
        try {
          await ctx.telegram.editMessageText(
            chatId,
            this.lastMenuMessageId[chatId],
            undefined,
            text,
            keyboard
          );
          return;
        } catch (error) {
          this.logger.warn('Не удалось отредактировать сообщение, отправляем новое');
        }
      }

      const message = await ctx.reply(text, keyboard);
      this.lastMenuMessageId[chatId] = message.message_id;
    } catch (error) {
      this.logger.error('Ошибка при обновлении сообщения меню:', error);
    }
  }

  private getMainMenuButtons() {
    return [
      [Markup.button.callback('📱 Категории новостей', 'categories')],
      [Markup.button.callback('📍 Настройка адреса', 'location_settings')],
    ];
  }

  private getLocationButtons(hasAddress: boolean) {
    const buttons = [
      [
        Markup.button.callback('📍 Отправить геолокацию', 'send_location'),
        Markup.button.callback('✏️ Ввести адрес', 'enter_address'),
      ],
    ];

    if (hasAddress) {
      buttons.push([Markup.button.callback('🗑 Удалить текущий адрес', 'delete_location')]);
    }

    buttons.push([Markup.button.callback('« Назад в меню', 'back_to_menu')]);
    return buttons;
  }

  private async getLocationSettingsText(telegram_id: number): Promise<string> {
    const subscriber = await this.subscriberRepository.findOne({
      where: { telegram_id },
    });

    let text = '📍 Настройка местоположения\n\n';
    
    if (subscriber?.address) {
      text += '📌 Ваш текущий адрес:\n';
      text += `${subscriber.address}\n\n`;
    } else {
      text += '❗️ У вас пока не указан адрес\n\n';
    }

    text += 'Выберите способ указания местоположения:\n\n' +
            '• Отправить геолокацию - поделитесь своим текущим местоположением\n' +
            '• Ввести адрес - укажите адрес вручную (например: "ул. Ленина, 10")';

    if (subscriber?.address) {
      text += '\n\nИли нажмите кнопку "Удалить", чтобы удалить текущий адрес';
    }

    return text;
  }

  private async getCategoryButtons(telegram_id: number) {
    const subscriber = await this.subscriberRepository.findOne({
      where: { telegram_id },
    });

    const subscribedCategories = subscriber?.categories || [];

    const buttons = Object.entries(this.categories).map(([key, name]) => {
      const isSubscribed = subscribedCategories.includes(key);
      const emoji = isSubscribed ? '✅' : '❌';
      return Markup.button.callback(`${emoji} ${name}`, `toggle_${key}`);
    });

    buttons.push(Markup.button.callback('« Назад в меню', 'back_to_menu'));

    return buttons;
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

  private async getAddressFromCoordinates(latitude: number, longitude: number): Promise<string> {
    try {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastNominatimRequest;
      if (timeSinceLastRequest < 1000) {
        await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastRequest));
      }
      this.lastNominatimRequest = Date.now();

      const response = await axios.get<NominatimResponse>(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=ru`,
        {
          headers: {
            'User-Agent': 'TelegramNewsBot/1.0'
          }
        }
      );

      const address = response.data.address;
      const components: string[] = [];

      if (address.road) {
        const streetType = address.road.toLowerCase().startsWith('улица') ? '' : 'ул. ';
        components.push(streetType + address.road);
      }

      if (address.house_number) {
        components.push(address.house_number);
      }

      if (components.length === 0) {
        if (address.suburb) components.push(address.suburb);
        else if (address.neighbourhood) components.push(address.neighbourhood);
        else if (address.residential) components.push(address.residential);
        else if (address.city) components.push(address.city);
        else if (address.town) components.push(address.town);
        else if (address.village) components.push(address.village);
      }

      if (address.city && !components.some(c => c.includes(address.city!))) {
        components.push(address.city);
      } else if (address.town && !components.some(c => c.includes(address.town!))) {
        components.push(address.town);
      } else if (address.village && !components.some(c => c.includes(address.village!))) {
        components.push(address.village);
      }

      return components.length > 0 
        ? components.join(', ')
        : `${latitude}, ${longitude}`;
    } catch (error) {
      this.logger.error('Ошибка при получении адреса:', error);
      return `${latitude}, ${longitude}`;
    }
  }

  private initializeBot() {
    this.bot.command('start', async (ctx) => {
      const telegram_id = ctx.from.id;
      
      let subscriber = await this.subscriberRepository.findOne({
        where: { telegram_id },
      });

      if (!subscriber) {
        subscriber = await this.subscriberRepository.save({
          telegram_id,
          categories: Object.keys(this.categories),
        });
      }

      const welcomeMessage =
        '👋 Добро пожаловать в бота новостей города Нерехта!\n\n' +
        'Этот бот будет присылать вам уведомления о новых новостях с официального сайта\n\n' +
        'Доступные команды:\n' +
        '• /subscribe - Управление подписками\n' +
        '• /about - Информация о боте\n\n' +
        'Разработчик: @danya_lobanov\n' +
        'Исходный код: https://github.com/DaniilL12321/news_bot\n\n' +
        '✅ Вы автоматически подписаны на все категории новостей. Используйте /subscribe для управления подписками.';

      await ctx.reply(welcomeMessage);
    });

    this.bot.command('subscribe', async (ctx) => {
      await this.updateMenuMessage(
        ctx,
        '🔔 Меню управления подписками',
        Markup.inlineKeyboard(this.getMainMenuButtons())
      );
    });

    this.bot.action('categories', async (ctx) => {
      const buttons = await this.getCategoryButtons(ctx.from.id);
      await ctx.editMessageText(
        'Управление подписками на категории новостей:\n✅ - включено, ❌ - выключено',
        Markup.inlineKeyboard(buttons, { columns: 1 })
      );
    });

    this.bot.action('location_settings', async (ctx) => {
      const telegram_id = ctx.from.id;
      const subscriber = await this.subscriberRepository.findOne({
        where: { telegram_id },
      });
      
      const text = await this.getLocationSettingsText(ctx.from.id);
      await ctx.editMessageText(
        text,
        Markup.inlineKeyboard(this.getLocationButtons(!!subscriber?.address))
      );
    });

    this.bot.action('send_location', async (ctx) => {
      await ctx.editMessageText(
        '📍 Отправка геолокации\n\n' +
        'Чтобы отправить свое местоположение:\n' +
        '1. Нажмите на значок 📎 (вложение)\n' +
        '2. Выберите "Геопозиция"\n' +
        '3. Отправьте свое текущее местоположение\n\n' +
        'Или вернитесь назад для выбора другого способа.',
        Markup.inlineKeyboard([
          [Markup.button.callback('« Назад к выбору способа', 'location_settings')]
        ])
      );
    });

    this.bot.action('enter_address', async (ctx) => {
      const telegram_id = ctx.from.id;
      let subscriber = await this.subscriberRepository.findOne({
        where: { telegram_id },
      });
      
      if (!subscriber) {
        subscriber = this.subscriberRepository.create({
          telegram_id,
          categories: [],
        });
      }
      
      subscriber.waitingForAddress = true;
      await this.subscriberRepository.save(subscriber);

      await ctx.editMessageText(
        '✏️ Ввод адреса\n\n' +
        'Пожалуйста, напишите ваш адрес в свободной форме.\n' +
        'Например: "ул. Ленина, 10" или "Красная площадь"\n\n' +
        'После ввода адреса я автоматически сохраню его.',
        Markup.inlineKeyboard([
          [Markup.button.callback('« Назад к выбору способа', 'location_settings')]
        ])
      );
    });

    this.bot.action('back_to_menu', async (ctx) => {
      await ctx.editMessageText(
        '🔔 Меню управления подписками',
        Markup.inlineKeyboard(this.getMainMenuButtons())
      );
    });

    this.bot.action('delete_location', async (ctx) => {
      const telegram_id = ctx.from.id;
      const subscriber = await this.subscriberRepository.findOne({
        where: { telegram_id },
      });

      if (subscriber) {
        subscriber.address = null;
        subscriber.latitude = null;
        subscriber.longitude = null;
        await this.subscriberRepository.save(subscriber);

        await ctx.answerCbQuery('🗑 Адрес успешно удален');
        
        const text = await this.getLocationSettingsText(telegram_id);
        await ctx.editMessageText(
          text,
          Markup.inlineKeyboard(this.getLocationButtons(false))
        );
      } else {
        await ctx.answerCbQuery('❌ Ошибка: адрес не найден');
      }
    });

    this.bot.on('location', async (ctx) => {
      await this.trackUserMessage(ctx);
      
      const { latitude, longitude } = ctx.message.location;
      const telegram_id = ctx.from.id;
      let subscriber = await this.subscriberRepository.findOne({
        where: { telegram_id },
      });

      if (!subscriber) {
        subscriber = this.subscriberRepository.create({
          telegram_id,
          categories: [],
        });
      }

      const address = await this.getAddressFromCoordinates(latitude, longitude);

      subscriber.latitude = latitude;
      subscriber.longitude = longitude;
      subscriber.address = address;
      subscriber.waitingForAddress = false;
      await this.subscriberRepository.save(subscriber);

      await this.updateMenuMessage(
        ctx,
        `✅ Адрес успешно сохранен!\n\n📍 Ваш адрес:\n${address}\n\nТеперь вы будете получать уведомления о событиях поблизости.`,
        Markup.inlineKeyboard(this.getMainMenuButtons())
      );
    });

    this.bot.on('text', async (ctx) => {
      await this.trackUserMessage(ctx);
      
      const telegram_id = ctx.from.id;
      const subscriber = await this.subscriberRepository.findOne({
        where: { telegram_id },
      });

      if (subscriber?.waitingForAddress) {
        const address = ctx.message.text;
        
        subscriber.address = address;
        subscriber.waitingForAddress = false;
        await this.subscriberRepository.save(subscriber);

        await this.updateMenuMessage(
          ctx,
          `✅ Адрес "${address}" успешно сохранен!\n\nТеперь вы будете получать уведомления о событиях поблизости.`,
          Markup.inlineKeyboard(this.getMainMenuButtons())
        );
      }
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

      const newButtons = await this.getCategoryButtons(telegram_id);
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [newButtons],
      });
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

  private isNewsRelevantToLocation(newsText: string, subscriberAddress: string): boolean {
    if (!subscriberAddress) return true;
    
    const normalizedNews = newsText.toLowerCase();
    const normalizedAddress = subscriberAddress.toLowerCase();
    
    this.logger.debug(`Проверка релевантности новости для адреса: ${subscriberAddress}`);
    this.logger.debug(`Текст новости: ${newsText}`);
    
    const addressComponents = normalizedAddress
      .replace(/\s+/g, ' ')
      .replace(/^ул\.?\s*/i, '')
      .replace(/^улица\s*/i, '')
      .split(/[,\s]+/)
      .filter(part => part.length > 0);

    this.logger.debug(`Компоненты адреса: ${JSON.stringify(addressComponents)}`);
    
    const streetVariants: string[] = [];
    if (addressComponents.length >= 1) {
      const streetName = addressComponents[0];
      streetVariants.push(
        streetName,
        `ул. ${streetName}`,
        `улица ${streetName}`,
        `ул.${streetName}`,
        `улица${streetName}`
      );
    }

    this.logger.debug(`Варианты написания улицы: ${JSON.stringify(streetVariants)}`);

    const hasStreetMatch = streetVariants.some(variant => {
      const matches = normalizedNews.includes(variant.toLowerCase());
      if (matches) {
        this.logger.debug(`Найдено совпадение улицы: ${variant}`);
      }
      return matches;
    });

    if (addressComponents.length >= 2) {
      const houseNumber = addressComponents[1];
      this.logger.debug(`Проверка номера дома: ${houseNumber}`);
      
      if (hasStreetMatch && normalizedNews.includes(houseNumber)) {
        this.logger.debug('Найдено точное совпадение номера дома');
        return true;
      }
      const houseNum = parseInt(houseNumber);
      if (hasStreetMatch && !isNaN(houseNum)) {
        const rangeMatches = normalizedNews.match(/дома?\s+(\d+)[-,\s]+(\d+)/g);
        if (rangeMatches) {
          this.logger.debug(`Найдены диапазоны домов: ${JSON.stringify(rangeMatches)}`);
          for (const match of rangeMatches) {
            const [start, end] = match.match(/\d+/g)!.map(Number);
            if (houseNum >= start && houseNum <= end) {
              this.logger.debug(`Номер дома ${houseNum} входит в диапазон ${start}-${end}`);
              return true;
            }
          }
        }
      }
    }

    this.logger.debug(`Результат проверки: ${hasStreetMatch ? 'найдена улица' : 'совпадений не найдено'}`);
    return hasStreetMatch;
  }

  async notifySubscribersWithMedia(
    text: string,
    imageUrls: string[],
    category: string = 'other',
    newsId?: number,
  ): Promise<{ sentCount: number; totalSubscribers: number }> {
    const subscribers = await this.subscriberRepository.find();
    let sentCount = 0;

    for (const subscriber of subscribers) {
      try {
        if (!subscriber.categories.includes(category) && !subscriber.categories.includes('all')) {
          continue;
        }

        let notificationText = text;
        if (subscriber.address && this.isNewsRelevantToLocation(text, subscriber.address)) {
          notificationText = `📍 Новость по вашему адресу:\n\n${text}`;
        }

        const reactionButtons = newsId ? await this.getReactionButtons(newsId, subscriber.telegram_id) : [];
        const keyboard = reactionButtons.length > 0 ? 
          { reply_markup: { inline_keyboard: [reactionButtons] } } : 
          {};

        if (imageUrls.length === 0) {
          await this.bot.telegram.sendMessage(subscriber.telegram_id, notificationText, keyboard);
        } else if (imageUrls.length === 1) {
          await this.bot.telegram.sendPhoto(subscriber.telegram_id, imageUrls[0], {
            caption: notificationText,
            ...keyboard,
          });
        } else {
          const media: InputMediaPhoto[] = imageUrls.map((url, index) => ({
            type: 'photo',
            media: url,
            caption: index === 0 ? notificationText : undefined,
          }));

          const message = await this.bot.telegram.sendMediaGroup(subscriber.telegram_id, media);
          if (reactionButtons.length > 0 && message && message[0]) {
            await this.bot.telegram.sendMessage(subscriber.telegram_id, '🔽 Реакции:', keyboard);
          }
        }
        sentCount++;
      } catch (error) {
        this.logger.error(`Ошибка при отправке сообщения в чат ${subscriber.telegram_id}:`, error);
      }
    }

    return {
      sentCount,
      totalSubscribers: subscribers.length
    };
  }

  determineCategory(title: string): string {
    title = title.toLowerCase();
    if (title.includes('электроснабжен')) return 'power';
    if (title.includes('вода') || title.includes('водоснабжен')) return 'water';
    return 'other';
  }
}
