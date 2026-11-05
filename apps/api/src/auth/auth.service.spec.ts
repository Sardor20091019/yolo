import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { JwtSecurityService } from './jwt.service';
import { DatabaseService } from '../database/database.service';

describe('AuthService JWT Integration', () => {
  let authService: AuthService;
  let jwtService: JwtSecurityService;
  let mockDb: any;

  const sampleUser = {
    id: 'usr_operator_01',
    email: 'admin@cctv.local',
    name: 'Chief Operator',
    picture: '',
    role: 'ADMIN',
    refresh_token_hash: null as string | null,
    refresh_token_expires_at: null as Date | null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(() => {
    const configService = new ConfigService({
      google: { clientId: 'test_client_id', clientSecret: 'test_secret' },
      jwt: {
        accessSecret: 'integration_test_access_secret_key_32c!',
        refreshSecret: 'integration_test_refresh_secret_key_32c!',
        accessExpiresInSeconds: 900,
        refreshExpiresInSeconds: 604800,
      },
    });

    jwtService = new JwtSecurityService(configService);

    mockDb = {
      users: { ...sampleUser },
      selectFrom: jest.fn().mockReturnValue({
        selectAll: jest.fn().mockReturnValue({
          where: jest.fn().mockImplementation((predicate) => ({
            executeTakeFirst: jest.fn().mockImplementation(async () => {
              return mockDb.users;
            }),
          })),
        }),
      }),
      updateTable: jest.fn().mockReturnValue({
        set: jest.fn().mockImplementation((updates) => {
          Object.assign(mockDb.users, updates);
          return {
            where: jest.fn().mockReturnValue({
              execute: jest.fn().mockResolvedValue(undefined),
              returningAll: jest.fn().mockReturnValue({
                executeTakeFirstOrThrow: jest.fn().mockResolvedValue(mockDb.users),
              }),
            }),
          };
        }),
      }),
      insertInto: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returningAll: jest.fn().mockReturnValue({
            executeTakeFirstOrThrow: jest.fn().mockImplementation(async () => mockDb.users),
          }),
        }),
      }),
    };

    const mockDatabaseService = {
      db: mockDb,
    } as unknown as DatabaseService;

    authService = new AuthService(configService, mockDatabaseService, jwtService);
  });

  it('should authenticate login, issue tokens, and store hashed refresh token', async () => {
    const response = await authService.login({ identifier: 'admin@cctv.local' });

    expect(response.accessToken).toBeDefined();
    expect(response.refreshToken).toBeDefined();
    expect(response.expiresIn).toBe(900);
    expect(response.user.id).toBe(sampleUser.id);

    expect(mockDb.users.refresh_token_hash).toBeDefined();
    expect(mockDb.users.refresh_token_hash).toContain(':');
    expect(mockDb.users.refresh_token_hash).not.toBe(response.refreshToken);

    const isMatch = jwtService.verifyRefreshTokenHash(
      response.refreshToken,
      mockDb.users.refresh_token_hash!,
    );
    expect(isMatch).toBe(true);
  });

  it('should rotate access and refresh tokens on valid refresh request', async () => {
    const initialLogin = await authService.login({ identifier: 'admin@cctv.local' });
    const oldRefreshToken = initialLogin.refreshToken;
    const oldHash = mockDb.users.refresh_token_hash;

    const refreshed = await authService.refreshTokens(oldRefreshToken);

    expect(refreshed.accessToken).toBeDefined();
    expect(refreshed.refreshToken).toBeDefined();
    expect(refreshed.refreshToken).not.toBe(oldRefreshToken);

    expect(mockDb.users.refresh_token_hash).not.toBe(oldHash);

    const isNewValid = jwtService.verifyRefreshTokenHash(
      refreshed.refreshToken,
      mockDb.users.refresh_token_hash!,
    );
    expect(isNewValid).toBe(true);
  });

  it('should reject refresh attempt when refresh token is revoked or corrupted', async () => {
    await authService.login({ identifier: 'admin@cctv.local' });
    mockDb.users.refresh_token_hash = null;

    await expect(authService.refreshTokens('corrupted_or_revoked_token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should revoke refresh token on logout', async () => {
    await authService.login({ identifier: 'admin@cctv.local' });
    expect(mockDb.users.refresh_token_hash).not.toBeNull();

    const logoutResult = await authService.logout(sampleUser.id);
    expect(logoutResult.success).toBe(true);
    expect(mockDb.users.refresh_token_hash).toBeNull();
    expect(mockDb.users.refresh_token_expires_at).toBeNull();
  });
});

