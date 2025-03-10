import { Injectable, Logger } from '@nestjs/common';
import { Connection } from 'typeorm';
import { InjectConnection } from '@nestjs/typeorm';
import axios from 'axios';

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly BACKUP_FOLDER = '/backups';
  private readonly BASE_URL: string;

  constructor(
    @InjectConnection()
    private connection: Connection,
  ) {
    if (
      !process.env.YANDEX_WEBDAV_URL ||
      !process.env.YANDEX_DISK_LOGIN ||
      !process.env.YANDEX_DISK_TOKEN
    ) {
      throw new Error(
        'Отсутствуют необходимые переменные окружения для Yandex WebDAV',
      );
    }
    this.BASE_URL = process.env.YANDEX_WEBDAV_URL;
  }

  private async makeRequest(method: string, path: string, data?: any) {
    try {
      return await axios({
        method,
        url: `${this.BASE_URL}${path}`,
        data,
        auth: {
          username: process.env.YANDEX_DISK_LOGIN!,
          password: process.env.YANDEX_DISK_TOKEN!,
        },
        headers: {
          'Content-Type': 'text/plain',
        },
      });
    } catch (error) {
      this.logger.error(`Ошибка WebDAV запроса: ${error.message}`);
      throw error;
    }
  }

  private async generateSQLDump(
    tableName: string,
    data: any[],
  ): Promise<string> {
    if (data.length === 0) return '';

    const columns = Object.keys(data[0]);
    let sql = `-- Dump of table ${tableName}\n`;
    sql += `-- ${new Date().toISOString()}\n\n`;

    sql += `TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE;\n\n`;

    const values = data
      .map((row) => {
        const rowValues = columns.map((col) => {
          const value = row[col];
          if (value === null) return 'NULL';
          if (typeof value === 'string')
            return `'${value.replace(/'/g, "''")}'`;
          if (value instanceof Date) return `'${value.toISOString()}'`;
          return value;
        });
        return `(${rowValues.join(', ')})`;
      })
      .join(',\n');

    sql += `INSERT INTO ${tableName} (${columns.join(', ')})\nVALUES\n${values};\n`;
    return sql;
  }

  private async ensureBackupFolder(): Promise<void> {
    try {
      await this.makeRequest('PROPFIND', this.BACKUP_FOLDER, null);
    } catch (error) {
      if (error?.response?.status === 404) {
        try {
          await this.makeRequest('MKCOL', this.BACKUP_FOLDER);
          this.logger.log('Создана папка для бэкапов');
        } catch (createError) {
          this.logger.error(
            'Ошибка при создании папки для бэкапов:',
            createError,
          );
          throw createError;
        }
      } else {
        throw error;
      }
    }
  }

  async createBackup(): Promise<void> {
    try {
      await this.ensureBackupFolder();

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      const newsData = await this.connection.getRepository('news').find();
      const newsSQL = await this.generateSQLDump('news', newsData);
      const newsFileName = `news_backup_${timestamp}.sql`;
      await this.makeRequest(
        'PUT',
        `${this.BACKUP_FOLDER}/${newsFileName}`,
        newsSQL,
      );
      this.logger.log(`Бэкап таблицы news создан: ${newsFileName}`);

      const subscribersData = await this.connection
        .getRepository('subscribers')
        .find();
      const subscribersSQL = await this.generateSQLDump(
        'subscribers',
        subscribersData,
      );
      const subscribersFileName = `subscribers_backup_${timestamp}.sql`;
      await this.makeRequest(
        'PUT',
        `${this.BACKUP_FOLDER}/${subscribersFileName}`,
        subscribersSQL,
      );
      this.logger.log(
        `Бэкап таблицы subscribers создан: ${subscribersFileName}`,
      );
    } catch (error) {
      this.logger.error('Ошибка при создании бэкапов:', error);
    }
  }
}
