import { IsString, IsNotEmpty, IsOptional, IsEmail } from 'class-validator';

export class GoogleAuthDto {
  @IsString()
  @IsNotEmpty()
  public credential!: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  public identifier!: string;

  @IsString()
  @IsOptional()
  public password?: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  public refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  @IsOptional()
  public refreshToken?: string;
}

export interface AuthUserProfile {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string;
}

export interface AuthConfigResponse {
  googleClientId: string;
}

export interface JwtTokenPayload {
  sub: string;
  email: string | null;
  name: string;
  role: string;
  type: 'access' | 'refresh';
  jti?: string;
  iat: number;
  exp: number;
}

export interface TokenPairResponse {
  user: AuthUserProfile;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  token: string;
}

