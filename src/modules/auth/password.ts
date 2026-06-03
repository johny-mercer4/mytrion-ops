import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';

const BCRYPT_ROUNDS = 12;

/**
 * Hash a password with bcrypt. A server-side pepper (PASSWORD_PEPPER) is mixed in
 * so leaked hashes are useless without the env secret. bcrypt truncates at 72
 * bytes, so the pepper is appended (passwords realistically stay well under that).
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain + env.PASSWORD_PEPPER, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain + env.PASSWORD_PEPPER, hash);
}
