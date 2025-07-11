import { Controller, Post, Body, Get, UseGuards, Req, Res, Render, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('login')
  @Render('login')
  getLoginPage() {
    return {};
  }

  @Post('login')
  async login(
    @Body() credentials: { username: string; password: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      console.log('Login attempt for user:', credentials.username);
      
      const admin = await this.authService.validateAdmin(
        credentials.username,
        credentials.password,
      );
      
      console.log('Admin validated successfully:', admin.id);
      
      const tokens = await this.authService.login(admin);
      
      console.log('Tokens generated successfully');
      
      response.cookie('refresh_token', tokens.refresh_token, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return tokens;
    } catch (error) {
      console.error('Login error:', error);
      throw new HttpException(
        {
          status: HttpStatus.UNAUTHORIZED,
          error: error.message || 'Неверные учетные данные',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Post('register')
  async register(@Body() credentials: { username: string; password: string }) {
    try {
      const adminsCount = await this.authService.getAdminsCount();
      if (adminsCount > 0) {
        throw new HttpException(
          'Регистрация новых администраторов запрещена',
          HttpStatus.FORBIDDEN,
        );
      }
      return this.authService.createAdmin(credentials.username, credentials.password);
    } catch (error) {
      console.error('Registration error:', error);
      throw new HttpException(
        {
          status: error.status || HttpStatus.BAD_REQUEST,
          error: error.message || 'Ошибка при регистрации',
        },
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  async refresh(@Req() req: any) {
    try {
      const admin = req.user;
      return this.authService.login(admin);
    } catch (error) {
      console.error('Token refresh error:', error);
      throw new HttpException(
        {
          status: HttpStatus.UNAUTHORIZED,
          error: 'Ошибка обновления токена',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('refresh_token');
    return { message: 'Выход выполнен успешно' };
  }
} 