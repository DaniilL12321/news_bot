import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private jwtService: JwtService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    try {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
          const payload = await this.jwtService.verifyAsync(token, {
            secret: process.env.JWT_ACCESS_SECRET
          });
          request.user = payload;
          return true;
        } catch (error) {
          this.logger.debug(`Invalid bearer token: ${error.message}`);
        }
      }

      const refreshToken = request.cookies?.refresh_token;
      if (refreshToken) {
        try {
          const payload = await this.jwtService.verifyAsync(refreshToken, {
            secret: process.env.JWT_REFRESH_SECRET
          });
          request.user = payload;
          return true;
        } catch (error) {
          this.logger.debug(`Invalid refresh token: ${error.message}`);
        }
      }

      this.logger.warn('No valid tokens found');
      throw new UnauthorizedException('Требуется авторизация');
    } catch (error) {
      this.logger.error('Authentication error:', error);
      throw new UnauthorizedException('Ошибка авторизации');
    }
  }
} 