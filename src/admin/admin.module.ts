import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { TelegramModule } from '../telegram/telegram.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { News } from '../news/entities/news.entity';
import { AuthModule } from '../auth/auth.module';
import { Admin } from './entities/admin.entity';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [
    TelegramModule,
    TypeOrmModule.forFeature([News, Admin]),
    AuthModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {} 