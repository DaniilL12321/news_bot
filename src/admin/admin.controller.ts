import { Controller, Get, Post, Body, Render, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @Render('admin')
  getAdminPage() {
    return {};
  }

  @Post('send-message')
  async sendCustomMessage(@Body() messageData: { 
    message: string;
    category?: string;
    imageUrls?: string[];
    saveToDatabase?: boolean;
  }) {
    return await this.adminService.sendCustomMessage(
      messageData.message,
      messageData.category,
      messageData.imageUrls,
      messageData.saveToDatabase
    );
  }
} 