import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { JwtSecurityService } from './jwt.service';
import { DatabaseService } from '../database/database.service';

describe('Security Controls & Vulnerability Remediations', () => {
  let authService: AuthService;
  let jwtService: JwtSecurityService;
  let mockDb: any;

  beforeEach(() => {
    const configService = new ConfigService({
      google: { clientId: 'trusted_client_id' },
      jwt: {
        accessSecret: 'security_test_access_secret_key_32c!',
        refreshSecret: 'security_test_refresh_secret_key_32c!',
        accessExpiresInSeconds: 900,
        refreshExpiresInSeconds: 604800,
      },
      auth: {
        devSecret: 'super_secure_admin_password_123',
      },
    });

    jwtService = new JwtSecurityService(configService);

    mockDb = {
      users: {
        id: 'usr_admin',
        email: 'admin@cctv.local',
        name: 'Administrator',
        picture: '',
        role: 'admin',
        refresh_token_hash: null,
        refresh_token_expires_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      selectFrom: jest.fn().mockReturnValue({
        selectAll: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            executeTakeFirst: jest.fn().mockImplementation(async () => mockDb.users),
          }),
        }),
      }),
      updateTable: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            execute: jest.fn().mockResolvedValue(undefined),
          }),
        }),
      }),
    };

    const mockDbService = { db: mockDb } as unknown as DatabaseService;
    authService = new AuthService(configService, mockDbService, jwtService);
  });

  describe('Unverified Google Token Mitigation', () => {
    it('should reject forged unverified 3-part base64 Google tokens', async () => {
      const forgedHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const forgedPayload = Buffer.from(JSON.stringify({ email: 'admin@cctv.local', sub: 'hacker_sub' })).toString('base64url');
      const forgedToken = `${forgedHeader}.${forgedPayload}.invalidsig`;

      await expect(authService.verifyGoogleCredential(forgedToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject empty or whitespace Google credential tokens', async () => {
      await expect(authService.verifyGoogleCredential('')).rejects.toThrow(UnauthorizedException);
      await expect(authService.verifyGoogleCredential('   ')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Passwordless Login Backdoor Mitigation', () => {
    it('should reject login attempt when password does not match secret', async () => {
      await expect(
        authService.login({ identifier: 'admin@cctv.local', password: 'wrong_password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should succeed login when correct secret password is provided', async () => {
      const res = await authService.login({
        identifier: 'admin@cctv.local',
        password: 'super_secure_admin_password_123',
      });
      expect(res.accessToken).toBeDefined();
      expect(res.user.email).toBe('admin@cctv.local');
    });
  });

  describe('JWT Verification Tamper-Proofing', () => {
    it('should reject forged access tokens with modified payload', () => {
      const validToken = jwtService.generateAccessToken({
        id: 'usr_123',
        email: 'user@cctv.local',
        name: 'Normal User',
        picture: '',
        role: 'user',
      });

      const parts = validToken.split('.');
      const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      decodedPayload.role = 'admin';
      const tamperedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      expect(() => jwtService.verifyAccessToken(tamperedToken)).toThrow(UnauthorizedException);
    });
  });
});
