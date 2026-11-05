import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  GoogleAuthDto,
  LoginDto,
  RefreshTokenDto,
  LogoutDto,
  TokenPairResponse,
  AuthConfigResponse,
  JwtTokenPayload,
} from './auth.dto';
import { UserRecord } from '../database/database.types';
import { JwtAuthGuard, AuthenticatedRequest } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('config')
  public getConfig(): AuthConfigResponse {
    return this.authService.getPublicConfig();
  }

  @Post('login')
  public async login(@Body() dto: LoginDto): Promise<TokenPairResponse> {
    return await this.authService.login(dto);
  }

  @Post('google')
  public async authenticateGoogle(@Body() dto: GoogleAuthDto): Promise<TokenPairResponse> {
    return await this.authService.authenticateGoogle(dto.credential);
  }

  @Post('refresh')
  public async refreshTokens(@Body() dto: RefreshTokenDto): Promise<TokenPairResponse> {
    return await this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  public async logout(
    @Body() dto: LogoutDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; message: string }> {
    if (dto.refreshToken) {
      return await this.authService.logoutByRefreshToken(dto.refreshToken);
    }
    if (req.user?.sub) {
      return await this.authService.logout(req.user.sub);
    }
    return { success: true, message: 'Logged out' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  public async getProfile(
    @CurrentUser() user: JwtTokenPayload,
  ): Promise<{ user: UserRecord | undefined; claims: JwtTokenPayload }> {
    const record = await this.authService.getUserById(user.sub);
    return {
      user: record,
      claims: user,
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
