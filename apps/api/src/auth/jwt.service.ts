import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { JwtTokenPayload, AuthUserProfile } from './auth.dto';

@Injectable()
export class JwtSecurityService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresInSeconds: number;
  private readonly refreshExpiresInSeconds: number;

  constructor(private readonly configService: ConfigService) {
    this.accessSecret = this.configService.get<string>(
      'jwt.accessSecret',
      'astro_cctv_access_secret_key_prod_32chars!',
    );
    this.refreshSecret = this.configService.get<string>(
      'jwt.refreshSecret',
      'astro_cctv_refresh_secret_key_prod_32chars!',
    );
    this.accessExpiresInSeconds = this.configService.get<number>('jwt.accessExpiresInSeconds', 900);
    this.refreshExpiresInSeconds = this.configService.get<number>('jwt.refreshExpiresInSeconds', 604800);
  }

  public getAccessExpiresInSeconds(): number {
    return this.accessExpiresInSeconds;
  }

  public getRefreshExpiresInSeconds(): number {
    return this.refreshExpiresInSeconds;
  }

  public generateAccessToken(user: AuthUserProfile): string {
    return this.signJwt(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        type: 'access',
      },
      this.accessSecret,
      this.accessExpiresInSeconds,
    );
  }

  public generateRefreshToken(user: AuthUserProfile): string {
    return this.signJwt(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        type: 'refresh',
        jti: crypto.randomBytes(16).toString('hex'),
      },
      this.refreshSecret,
      this.refreshExpiresInSeconds,
    );
  }

  public verifyAccessToken(token: string): JwtTokenPayload {
    const payload = this.verifyJwt(token, this.accessSecret);
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Token type mismatch: expected access token');
    }
    return payload;
  }

  public verifyRefreshToken(token: string): JwtTokenPayload {
    const payload = this.verifyJwt(token, this.refreshSecret);
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token type mismatch: expected refresh token');
    }
    return payload;
  }

  public hashRefreshToken(rawToken: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(rawToken, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  public verifyRefreshTokenHash(rawToken: string, storedHash: string): boolean {
    if (!storedHash || !storedHash.includes(':')) {
      return false;
    }
    const [salt, expectedHash] = storedHash.split(':');
    if (!salt || !expectedHash) {
      return false;
    }
    try {
      const computed = crypto.scryptSync(rawToken, salt, 64).toString('hex');
      const compBuf = Buffer.from(computed, 'hex');
      const expBuf = Buffer.from(expectedHash, 'hex');
      if (compBuf.length !== expBuf.length) {
        return false;
      }
      return crypto.timingSafeEqual(compBuf, expBuf);
    } catch {
      return false;
    }
  }

  private signJwt(
    claims: Omit<JwtTokenPayload, 'iat' | 'exp'>,
    secret: string,
    expiresInSeconds: number,
  ): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JwtTokenPayload = {
      ...claims,
      iat: now,
      exp: now + expiresInSeconds,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private verifyJwt(token: string, secret: string): JwtTokenPayload {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Missing token');
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed token structure');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expSigBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(sigBuf, expSigBuf)) {
      throw new UnauthorizedException('Invalid token signature');
    }

    let payload: JwtTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8')) as JwtTokenPayload;
    } catch {
      throw new UnauthorizedException('Corrupt token payload');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new UnauthorizedException('Token has expired');
    }

    return payload;
  }
}
