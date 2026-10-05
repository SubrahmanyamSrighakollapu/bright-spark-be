export interface AuthenticatedUser {
  userId: string;
  partyId: string | null;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface UserAuthRecord extends AuthenticatedUser {
  fullName: string;
  passwordHash: string;
  status: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
}
