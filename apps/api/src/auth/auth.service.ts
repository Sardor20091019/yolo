import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service';
import { UserRecord } from '../database/database.types';
import { JwtSecurityService } from './jwt.service';
import {
  AuthUserProfile,
  AuthConfigResponse,
  LoginDto,
  TokenPairResponse,
} from './auth.dto';

@Injectable()
export class AuthService {
  private readonly logger: Logger = new Logger(AuthService.name);
  private readonly googleClientId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly jwtSecurityService: JwtSecurityService,
  ) {
    this.googleClientId = this.configService.get<string>('google.clientId', '');
  }

  public getPublicConfig(): AuthConfigResponse {
    return {
      googleClientId: this.googleClientId,
    };
  }

  public async getAllUsers(): Promise<UserRecord[]> {
    return await this.databaseService.db
      .selectFrom('users')
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();
  }

  public async getUserById(id: string): Promise<UserRecord | undefined> {
    return await this.databaseService.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  public async getUserByIdOrEmail(identifier: string): Promise<UserRecord | undefined> {
    const clean = identifier.trim();
    return await this.databaseService.db
      .selectFrom('users')
      .selectAll()
      .where((eb) => eb.or([eb('id', '=', clean), eb('email', '=', clean)]))
      .executeTakeFirst();
  }

  public async createUser(dto: { name: string; email?: string }): Promise<UserRecord> {
    const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    return await this.databaseService.db
      .insertInto('users')
      .values({
        id,
        name: dto.name,
        email: dto.email || null,
        picture: '',
        role: 'user',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async deleteUser(id: string): Promise<{ success: boolean; id: string }> {
    await this.databaseService.db
      .deleteFrom('users')
      .where('id', '=', id)
      .execute();
    return { success: true, id };
  }

  public async updateUserRole(userId: string, role: string): Promise<UserRecord> {
    const normalizedRole = role.toLowerCase().trim();
    if (normalizedRole !== 'admin' && normalizedRole !== 'user') {
      throw new BadRequestException('Role can only be set to user or admin');
    }
    return await this.databaseService.db
      .updateTable('users')
      .set({
        role: normalizedRole,
        updated_at: sql`CURRENT_TIMESTAMP` as unknown as Date,
      })
      .where('id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async saveOrUpdateUser(profile: AuthUserProfile): Promise<UserRecord> {
    const existing = await this.databaseService.db
      .selectFrom('users')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb('id', '=', profile.id),
          profile.email ? eb('email', '=', profile.email) : eb('id', '=', profile.id),
        ]),
      )
      .executeTakeFirst();

    if (existing) {
      const sanitizedRole = (existing.role?.toLowerCase() === 'admin') ? 'admin' : 'user';
      return await this.databaseService.db
        .updateTable('users')
        .set({
          name: profile.name,
          email: profile.email || existing.email,
          picture: profile.picture || existing.picture,
          role: sanitizedRole,
          updated_at: sql`CURRENT_TIMESTAMP` as unknown as Date,
        })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    const totalUsers = await this.databaseService.db
      .selectFrom('users')
      .select(sql<number>`count(*)::int`.as('count'))
      .executeTakeFirst();

    const isFirstUser = (totalUsers?.count ?? 0) === 0;

    const adminEmailsConfig = this.configService.get<string>(
      'auth.adminEmails',
      'admin@cctv.local,sardor091019@gmail.com,sardor20091019@gmail.com,sardorsunatullayev@gmail.com',
    );
    const adminEmails = adminEmailsConfig.split(',').map((e) => e.trim().toLowerCase());
    const isEmailAdmin = profile.email && adminEmails.includes(profile.email.toLowerCase());

    const assignedRole = (isFirstUser || isEmailAdmin || profile.role?.toLowerCase() === 'admin') ? 'admin' : 'user';

    return await this.databaseService.db
      .insertInto('users')
      .values({
        id: profile.id,
        name: profile.name,
        email: profile.email,
        picture: profile.picture || '',
        role: assignedRole,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async verifyGoogleCredential(credential: string): Promise<AuthUserProfile> {
    if (!credential || credential.trim().length === 0) {
      throw new UnauthorizedException('Missing Google credential token');
    }

    let profile: AuthUserProfile | null = null;

    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
        { method: 'GET' },
      );

      if (response.ok) {
        const payload = (await response.json()) as Record<string, any>;
        profile = {
          id: payload.sub || `google_${Date.now()}`,
          email: payload.email || 'user@shoplifting-cctv.local',
          name: payload.name || payload.email || 'Store User',
          picture: payload.picture || '',
          role: 'user',
        };
      }
    } catch {}

    if (!profile) {
      try {
        const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: {
            Authorization: `Bearer ${credential}`,
          },
        });

        if (userinfoRes.ok) {
          const info = (await userinfoRes.json()) as Record<string, any>;
          profile = {
            id: info.sub || `google_${Date.now()}`,
            email: info.email || 'user@shoplifting-cctv.local',
            name: info.name || info.email || 'Store User',
            picture: info.picture || '',
            role: 'user',
          };
        }
      } catch {}
    }

    if (!profile) {
      try {
        const parts = credential.split('.');
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
          const decodedPayload = JSON.parse(payloadJson);
          if (decodedPayload.email || decodedPayload.sub) {
            profile = {
              id: decodedPayload.sub || `google_${Date.now()}`,
              email: decodedPayload.email || 'user@shoplifting-cctv.local',
              name: decodedPayload.name || decodedPayload.email || 'Store User',
              picture: decodedPayload.picture || '',
              role: 'user',
            };
          }
        }
      } catch {
        throw new UnauthorizedException('Invalid Google token format');
      }
    }

    if (!profile) {
      throw new UnauthorizedException('Failed to authenticate Google identity');
    }

    const saved = await this.saveOrUpdateUser(profile);
    return {
      id: saved.id,
      email: saved.email || profile.email,
      name: saved.name,
      picture: saved.picture,
      role: saved.role,
    };
  }

  public async authenticateGoogle(credential: string): Promise<TokenPairResponse> {
    const profile = await this.verifyGoogleCredential(credential);
    return await this.issueAndPersistTokenPair(profile);
  }

  public async login(dto: LoginDto): Promise<TokenPairResponse> {
    const cleanId = dto.identifier.trim();
    if (!cleanId) {
      throw new UnauthorizedException('Identifier is required');
    }

    let user = await this.databaseService.db
      .selectFrom('users')
      .selectAll()
      .where((eb) => eb.or([eb('id', '=', cleanId), eb('email', '=', cleanId)]))
      .executeTakeFirst();

    if (!user) {
      const created = await this.createUser({
        name: cleanId.includes('@') ? cleanId.split('@')[0] : cleanId,
        email: cleanId.includes('@') ? cleanId : undefined,
      });
      user = created;
    }

    const profile: AuthUserProfile = {
      id: user.id,
      email: user.email || `${user.id}@cctv.local`,
      name: user.name,
      picture: user.picture || '',
      role: user.role,
    };

    return await this.issueAndPersistTokenPair(profile);
  }

  public async refreshTokens(rawRefreshToken: string): Promise<TokenPairResponse> {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      throw new UnauthorizedException('Refresh token is required');
    }

    const payload = this.jwtSecurityService.verifyRefreshToken(rawRefreshToken);
    const user = await this.databaseService.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', payload.sub)
      .executeTakeFirst();

    if (!user || !user.refresh_token_hash) {
      throw new UnauthorizedException('Session expired or revoked. Please log in again.');
    }

    if (
      user.refresh_token_expires_at &&
      new Date(user.refresh_token_expires_at).getTime() < Date.now()
    ) {
      await this.revokeRefreshToken(user.id);
      throw new UnauthorizedException('Refresh token has expired');
    }

    const isValid = this.jwtSecurityService.verifyRefreshTokenHash(
      rawRefreshToken,
      user.refresh_token_hash,
    );

    if (!isValid) {
      await this.revokeRefreshToken(user.id);
      throw new UnauthorizedException('Refresh token verification failed');
    }

    const profile: AuthUserProfile = {
      id: user.id,
      email: user.email || payload.email || 'operator@cctv.local',
      name: user.name,
      picture: user.picture || '',
      role: user.role,
    };

    return await this.issueAndPersistTokenPair(profile);
  }

  public async logout(userId: string): Promise<{ success: boolean; message: string }> {
    await this.revokeRefreshToken(userId);
    return {
      success: true,
      message: 'Logged out successfully and revoked active refresh tokens',
    };
  }

  public async logoutByRefreshToken(
    rawRefreshToken: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const payload = this.jwtSecurityService.verifyRefreshToken(rawRefreshToken);
      return await this.logout(payload.sub);
    } catch {
      return { success: true, message: 'Logged out' };
    }
  }

  private async issueAndPersistTokenPair(profile: AuthUserProfile): Promise<TokenPairResponse> {
    const accessToken = this.jwtSecurityService.generateAccessToken(profile);
    const refreshToken = this.jwtSecurityService.generateRefreshToken(profile);
    const tokenHash = this.jwtSecurityService.hashRefreshToken(refreshToken);
    const expiresAt = new Date(
      Date.now() + this.jwtSecurityService.getRefreshExpiresInSeconds() * 1000,
    );

    await this.databaseService.db
      .updateTable('users')
      .set({
        refresh_token_hash: tokenHash,
        refresh_token_expires_at: expiresAt,
        updated_at: sql`CURRENT_TIMESTAMP` as unknown as Date,
      })
      .where('id', '=', profile.id)
      .execute();

    return {
      user: profile,
      accessToken,
      refreshToken,
      expiresIn: this.jwtSecurityService.getAccessExpiresInSeconds(),
      token: accessToken,
    };
  }

  private async revokeRefreshToken(userId: string): Promise<void> {
    await this.databaseService.db
      .updateTable('users')
      .set({
        refresh_token_hash: null,
        refresh_token_expires_at: null,
        updated_at: sql`CURRENT_TIMESTAMP` as unknown as Date,
      })
      .where('id', '=', userId)
      .execute();
  }
}
