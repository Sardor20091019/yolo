import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  NotFoundException,
  UnauthorizedException,
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
  @UseGuards(JwtAuthGuard)
  public async getAuthUsers(
    @CurrentUser() user: JwtTokenPayload,
  ): Promise<UserRecord[]> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    return await this.authService.getAllUsers();
  }

  @Get('db-user/:identifier')
  @UseGuards(JwtAuthGuard)
  public async getDbUser(
    @CurrentUser() user: JwtTokenPayload,
    @Param('identifier') identifier: string,
  ): Promise<UserRecord> {
    const isOwner = user.sub === identifier || user.email === identifier;
    if (user.role !== 'admin' && !isOwner) {
      throw new UnauthorizedException('Access denied');
    }
    const foundUser = await this.authService.getUserByIdOrEmail(identifier);
    if (!foundUser) {
      throw new NotFoundException(`User with identifier "${identifier}" not found in database`);
    }
    return foundUser;
  }

  @Post('users')
  @UseGuards(JwtAuthGuard)
  public async createAuthUser(
    @CurrentUser() user: JwtTokenPayload,
    @Body() dto: { name: string; email?: string },
  ): Promise<UserRecord> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    return await this.authService.createUser(dto);
  }

  @Post('role')
  @UseGuards(JwtAuthGuard)
  public async updateRole(
    @CurrentUser() user: JwtTokenPayload,
    @Body() dto: { userId: string; role: 'admin' | 'user' },
  ): Promise<{ success: boolean; user: UserRecord }> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    const updated = await this.authService.updateUserRole(dto.userId, dto.role);
    return { success: true, user: updated };
  }

  @Delete('users/:id')
  @UseGuards(JwtAuthGuard)
  public async deleteAuthUser(
    @CurrentUser() user: JwtTokenPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; id: string }> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    return await this.authService.deleteUser(id);
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  public async getAllUsers(
    @CurrentUser() user: JwtTokenPayload,
  ): Promise<UserRecord[]> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    return await this.authService.getAllUsers();
  }

  @Post()
  public async createUser(
    @CurrentUser() user: JwtTokenPayload,
    @Body() dto: { name: string; email?: string },
  ): Promise<UserRecord> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    return await this.authService.createUser(dto);
  }

  @Delete(':id')
  public async deleteUser(
    @CurrentUser() user: JwtTokenPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; id: string }> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    return await this.authService.deleteUser(id);
  }
}
