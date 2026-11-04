import { IsString, IsNotEmpty } from 'class-validator';

export class GoogleAuthDto {
  @IsString()
  @IsNotEmpty()
  public credential!: string;
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

