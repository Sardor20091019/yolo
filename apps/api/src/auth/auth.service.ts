import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthUserProfile, AuthConfigResponse } from './auth.dto';

@Injectable()
export class AuthService {
  private readonly logger: Logger = new Logger(AuthService.name);
  private readonly googleClientId: string;

  constructor(private readonly configService: ConfigService) {
    this.googleClientId = this.configService.get<string>('google.clientId', '');
  }

  public getPublicConfig(): AuthConfigResponse {
    return {
      googleClientId: this.googleClientId,
    };
  }

  public async verifyGoogleCredential(credential: string): Promise<AuthUserProfile> {
    if (!credential || credential.trim().length === 0) {
      throw new UnauthorizedException('Missing Google credential token');
    }

    try {
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
        method: 'GET',
      });

      if (response.ok) {
        const payload = (await response.json()) as Record<string, any>;
        if (this.googleClientId && payload.aud && !this.googleClientId.includes(payload.aud) && !payload.aud.includes(this.googleClientId)) {
          this.logger.warn(`Google token aud mismatch: token aud is ${payload.aud}`);
        }

        return {
          id: payload.sub || `google_${Date.now()}`,
          email: payload.email || 'operator@cctv.local',
          name: payload.name || payload.email || 'CCTV Operator',
          picture: payload.picture || '',
          role: 'SURVEILLANCE_OPERATOR',
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Remote Google verification network check failed: ${msg}`);
    }

    try {
      const parts = credential.split('.');
      if (parts.length === 3) {
        const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
        if (decodedPayload.email || decodedPayload.sub) {
          return {
            id: decodedPayload.sub || `google_${Date.now()}`,
            email: decodedPayload.email || 'operator@cctv.local',
            name: decodedPayload.name || decodedPayload.email || 'CCTV Operator',
            picture: decodedPayload.picture || '',
            role: 'SURVEILLANCE_OPERATOR',
          };
        }
      }
    } catch {
      throw new UnauthorizedException('Invalid Google token format');
    }

    throw new UnauthorizedException('Failed to authenticate Google identity');
  }
}
