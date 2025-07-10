import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Admin } from '../admin/entities/admin.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
    private jwtService: JwtService,
  ) {}

  async validateAdmin(username: string, password: string): Promise<Admin> {
    this.logger.debug(`Attempting to validate admin: ${username}`);
    
    const admin = await this.adminRepository.findOne({ where: { username } });
    if (!admin) {
      this.logger.warn(`Admin not found: ${username}`);
      throw new UnauthorizedException('Неверное имя пользователя');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      this.logger.warn(`Invalid password for admin: ${username}`);
      throw new UnauthorizedException('Неверный пароль');
    }

    this.logger.debug(`Admin validated successfully: ${username}`);
    return admin;
  }

  async login(admin: Admin) {
    this.logger.debug(`Generating tokens for admin: ${admin.username}`);
    
    const payload = { sub: admin.id, username: admin.username };
    
    try {
      const [accessToken, refreshToken] = await Promise.all([
        this.jwtService.signAsync(payload, {
          secret: process.env.JWT_ACCESS_SECRET,
          expiresIn: '15m',
        }),
        this.jwtService.signAsync(payload, {
          secret: process.env.JWT_REFRESH_SECRET,
          expiresIn: '7d',
        }),
      ]);

      await this.adminRepository.update(admin.id, {
        last_login: new Date(),
      });

      this.logger.debug(`Tokens generated successfully for admin: ${admin.username}`);
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
      };
    } catch (error) {
      this.logger.error(`Error generating tokens for admin: ${admin.username}`, error.stack);
      throw new UnauthorizedException('Ошибка генерации токенов');
    }
  }

  async refreshTokens(refreshToken: string) {
    try {
      this.logger.debug('Verifying refresh token');
      
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      const admin = await this.adminRepository.findOne({
        where: { id: payload.sub },
      });

      if (!admin) {
        this.logger.warn(`Admin not found for refresh token. ID: ${payload.sub}`);
        throw new UnauthorizedException('Администратор не найден');
      }

      this.logger.debug(`Refresh token verified for admin: ${admin.username}`);
      return this.login(admin);
    } catch (error) {
      this.logger.error('Error refreshing tokens', error.stack);
      throw new UnauthorizedException('Недействительный токен обновления');
    }
  }

  async createAdmin(username: string, password: string): Promise<Admin> {
    this.logger.debug(`Creating new admin: ${username}`);
    
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const admin = this.adminRepository.create({
        username,
        password: hashedPassword,
      });
      
      const savedAdmin = await this.adminRepository.save(admin);
      this.logger.debug(`Admin created successfully: ${username}`);
      return savedAdmin;
    } catch (error) {
      this.logger.error(`Error creating admin: ${username}`, error.stack);
      throw new Error('Ошибка при создании администратора');
    }
  }

  async getAdminsCount(): Promise<number> {
    try {
      const count = await this.adminRepository.count();
      this.logger.debug(`Current admin count: ${count}`);
      return count;
    } catch (error) {
      this.logger.error('Error getting admin count', error.stack);
      throw new Error('Ошибка при получении количества администраторов');
    }
  }
} 