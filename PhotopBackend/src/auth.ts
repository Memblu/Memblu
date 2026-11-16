import crypto from "node:crypto";
import { db } from "./db.js";
import { UserRecord, SessionRecord } from "./types.js";

export function generateId(): string {
  // 24 hex characters - exactly matching standard MongoDB ObjectId format
  // which satisfies Photop's `LikeID.substring(0, LikeID.length / 2)` contract
  return crypto.randomBytes(12).toString("hex");
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

export function createSession(userId: string, ip: string): { token: string; expireDuration: number } {
  const token = crypto.randomBytes(32).toString("hex");
  const expireDuration = 2592000; // 30 days in seconds
  const now = Date.now();
  const expiresAt = Math.floor(now / 1000) + expireDuration;

  const stmt = db.prepare(`
    INSERT INTO sessions (token, user_id, ip, last_visit, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(token, userId, ip, now, expiresAt);

  return { token, expireDuration };
}

export function validateSession(token: string | undefined, userId: string | undefined, ip?: string): UserRecord | null {
  if (!token || !userId) return null;

  const cleanToken = token.replace("DO_NOT_SHARE_", "");
  const now = Math.floor(Date.now() / 1000);

  const sessionStmt = db.prepare(`
    SELECT * FROM sessions WHERE token = ? AND user_id = ? AND expires_at > ?
  `);
  const session = sessionStmt.get(cleanToken, userId, now) as SessionRecord | undefined;
  if (!session) return null;

  // Update last visit timestamp
  db.prepare(`UPDATE sessions SET last_visit = ? WHERE token = ?`).run(Date.now(), cleanToken);

  const userStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
  const user = userStmt.get(userId) as UserRecord | undefined;
  return user || null;
}
