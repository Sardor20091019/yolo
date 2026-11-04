import { Controller, Post, Get, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleAuthDto, AuthUserProfile, AuthConfigResponse } from './auth.dto';

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
}
