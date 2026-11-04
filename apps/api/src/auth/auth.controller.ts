import { Controller, Post, Get, Delete, Body, Param } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleAuthDto, AuthUserProfile, AuthConfigResponse } from './auth.dto';
import { UserRecord } from '../database/database.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('config')
  public getConfig(): AuthConfigResponse {
    return this.authService.getPublicConfig();
  }

  @Post('google')
  public async authenticateGoogle(@Body() dto: GoogleAuthDto): Promise<{ user: AuthUserProfile; token: string }> {
    const user = await this.authService.verifyGoogleCredential(dto.credential);
    return {
      user,
      token: `cctv_session_${user.id}_${Date.now()}`,
    };
  }

  @Get('users')
  public async getAuthUsers(): Promise<UserRecord[]> {
    return await this.authService.getAllUsers();
  }

  @Post('users')
  public async createAuthUser(@Body() dto: { name: string; email?: string }): Promise<UserRecord> {
    return await this.authService.createUser(dto);
  }

  @Delete('users/:id')
  public async deleteAuthUser(@Param('id') id: string): Promise<{ success: boolean; id: string }> {
    return await this.authService.deleteUser(id);
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  public async getAllUsers(): Promise<UserRecord[]> {
    return await this.authService.getAllUsers();
  }

  @Post()
  public async createUser(@Body() dto: { name: string; email?: string }): Promise<UserRecord> {
    return await this.authService.createUser(dto);
  }

  @Delete(':id')
  public async deleteUser(@Param('id') id: string): Promise<{ success: boolean; id: string }> {
    return await this.authService.deleteUser(id);
  }
}
