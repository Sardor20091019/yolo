import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtSecurityService } from './jwt.service';
import { AuthUserProfile } from './auth.dto';

describe('JwtSecurityService', () => {
  let service: JwtSecurityService;
  let configService: ConfigService;

  const mockUser: AuthUserProfile = {
    id: 'usr_test_123',
    email: 'operator@cctv.local',
    name: 'Tactical Operator',
    picture: '',
    role: 'ADMIN',
  };

  beforeEach(() => {
    configService = new ConfigService({
      jwt: {
        accessSecret: 'unit_test_access_secret_key_32chars_long!',
        refreshSecret: 'unit_test_refresh_secret_key_32chars_long!',
        accessExpiresInSeconds: 900,
        refreshExpiresInSeconds: 604800,
      },
    });
    service = new JwtSecurityService(configService);
  });

  it('should generate valid access token that verifies successfully', () => {
    const token = service.generateAccessToken(mockUser);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const verified = service.verifyAccessToken(token);
    expect(verified.sub).toBe(mockUser.id);
    expect(verified.email).toBe(mockUser.email);
    expect(verified.name).toBe(mockUser.name);
    expect(verified.role).toBe(mockUser.role);
    expect(verified.type).toBe('access');
  });

  it('should generate valid refresh token that verifies successfully', () => {
    const refreshToken = service.generateRefreshToken(mockUser);
    expect(typeof refreshToken).toBe('string');
    expect(refreshToken.split('.').length).toBe(3);

    const verified = service.verifyRefreshToken(refreshToken);
    expect(verified.sub).toBe(mockUser.id);
    expect(verified.type).toBe('refresh');
  });

  it('should reject access token verification if supplied a refresh token', () => {
    const refreshToken = service.generateRefreshToken(mockUser);
    expect(() => service.verifyAccessToken(refreshToken)).toThrow(UnauthorizedException);
  });

  it('should reject refresh token verification if supplied an access token', () => {
    const accessToken = service.generateAccessToken(mockUser);
    expect(() => service.verifyRefreshToken(accessToken)).toThrow(UnauthorizedException);
  });

  it('should reject tampered tokens with invalid signature', () => {
    const token = service.generateAccessToken(mockUser);
    const parts = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...mockUser, role: 'SUPERUSER' }),
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    expect(() => service.verifyAccessToken(tamperedToken)).toThrow(UnauthorizedException);
  });

  it('should hash refresh token cryptographically and verify positive match', () => {
    const rawToken = service.generateRefreshToken(mockUser);
    const hash = service.hashRefreshToken(rawToken);

    expect(hash).toContain(':');
    const isMatch = service.verifyRefreshTokenHash(rawToken, hash);
    expect(isMatch).toBe(true);
  });

  it('should reject mismatched refresh token against stored hash', () => {
    const rawToken = service.generateRefreshToken(mockUser);
    const hash = service.hashRefreshToken(rawToken);

    const otherToken = service.generateRefreshToken({ ...mockUser, id: 'other_user' });
    const isMatch = service.verifyRefreshTokenHash(otherToken, hash);
    expect(isMatch).toBe(false);
  });
});

