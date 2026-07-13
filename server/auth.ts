import type Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export type AuthUser = { id: string; username: string; role: "ADMIN" | "USER" };
export type Invitation = { id: string; createdAtUtc: string; expiresAtUtc: string | null; maxUses: number; uses: number; revokedAtUtc: string | null; createdByUsername: string };

const USERNAME = /^[a-zA-Z0-9_.-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 10;
const SESSION_DAYS = Math.max(1, Math.min(30, Number(process.env.SESSION_DAYS ?? 7)) || 7);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const now = () => new Date().toISOString();

export function validateCredentials(username: unknown, password: unknown) {
  const cleanUsername = String(username ?? "").trim();
  const cleanPassword = String(password ?? "");
  if (!USERNAME.test(cleanUsername)) throw new Error("INVALID_USERNAME");
  if (cleanPassword.length < PASSWORD_MIN_LENGTH || cleanPassword.length > 256) throw new Error("WEAK_PASSWORD");
  return { username: cleanUsername, password: cleanPassword };
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const digest = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url");
  return `scrypt$${salt}$${digest}`;
}

export function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, digest] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !digest) return false;
  const actual = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(digest, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function seedInitialAdmin(db: Database.Database) {
  const count = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  if (count !== 0) return null;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!password) return null;
  const { username, password: validPassword } = validateCredentials(process.env.INITIAL_ADMIN_USERNAME ?? "admin", password);
  const user: AuthUser = { id: randomUUID(), username, role: "ADMIN" };
  db.transaction(() => {
    db.prepare("INSERT INTO users (id,username,password_hash,role,created_at_utc) VALUES (?,?,?,?,?)")
      .run(user.id, user.username, hashPassword(validPassword), user.role, now());
    // Preserve existing single-user data when authentication is enabled on an old database.
    db.prepare("UPDATE spots SET owner_user_id=? WHERE owner_user_id IS NULL").run(user.id);
  })();
  return user;
}

export function authenticate(db: Database.Database, username: unknown, password: unknown): AuthUser | null {
  const cleanUsername = String(username ?? "").trim();
  const cleanPassword = String(password ?? "");
  const row = db.prepare("SELECT id,username,password_hash,role,disabled_at_utc FROM users WHERE username=? COLLATE NOCASE").get(cleanUsername) as { id: string; username: string; password_hash: string; role: AuthUser["role"]; disabled_at_utc: string | null } | undefined;
  if (!row || row.disabled_at_utc || !verifyPassword(cleanPassword, row.password_hash)) return null;
  db.prepare("UPDATE users SET last_login_at_utc=? WHERE id=?").run(now(), row.id);
  return { id: row.id, username: row.username, role: row.role };
}

export function createSession(db: Database.Database, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const createdAtUtc = now();
  const expiresAtUtc = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare("DELETE FROM user_sessions WHERE expires_at_utc <= ?").run(createdAtUtc);
  db.prepare("INSERT INTO user_sessions (id,user_id,token_hash,created_at_utc,expires_at_utc,last_seen_at_utc) VALUES (?,?,?,?,?,?)")
    .run(randomUUID(), userId, hashToken(token), createdAtUtc, expiresAtUtc, createdAtUtc);
  return { token, expiresAtUtc };
}

export function getSessionUser(db: Database.Database, token: string | undefined): AuthUser | null {
  if (!token || token.length < 20) return null;
  const timestamp = now();
  const row = db.prepare(`SELECT u.id,u.username,u.role,s.id AS session_id FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at_utc>? AND u.disabled_at_utc IS NULL`)
    .get(hashToken(token), timestamp) as { id: string; username: string; role: AuthUser["role"]; session_id: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE user_sessions SET last_seen_at_utc=? WHERE id=?").run(timestamp, row.session_id);
  return { id: row.id, username: row.username, role: row.role };
}

export function deleteSession(db: Database.Database, token: string | undefined) {
  if (token) db.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(hashToken(token));
}

export function createInvitation(db: Database.Database, adminId: string, input: { maxUses?: unknown; expiresAtUtc?: unknown }) {
  const maxUses = Number(input.maxUses ?? 1);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) throw new Error("INVALID_INVITATION_USE_LIMIT");
  const expiresAtUtc = input.expiresAtUtc ? new Date(String(input.expiresAtUtc)).toISOString() : null;
  if (input.expiresAtUtc && Number.isNaN(new Date(String(input.expiresAtUtc)).getTime())) throw new Error("INVALID_INVITATION_EXPIRY");
  if (expiresAtUtc && new Date(expiresAtUtc).getTime() <= Date.now()) throw new Error("INVITATION_EXPIRY_IN_PAST");
  const code = `TL-${randomBytes(12).toString("hex").toUpperCase()}`;
  const id = randomUUID(), createdAtUtc = now();
  db.prepare("INSERT INTO invitation_codes (id,code_hash,created_by_user_id,created_at_utc,expires_at_utc,max_uses,uses) VALUES (?,?,?,?,?,?,0)")
    .run(id, hashToken(code), adminId, createdAtUtc, expiresAtUtc, maxUses);
  return { id, code, createdAtUtc, expiresAtUtc, maxUses, uses: 0 };
}

export function listInvitations(db: Database.Database): Invitation[] {
  return db.prepare(`SELECT i.id,i.created_at_utc AS createdAtUtc,i.expires_at_utc AS expiresAtUtc,i.max_uses AS maxUses,i.uses,i.revoked_at_utc AS revokedAtUtc,u.username AS createdByUsername FROM invitation_codes i JOIN users u ON u.id=i.created_by_user_id ORDER BY i.created_at_utc DESC LIMIT 100`).all() as Invitation[];
}

export function revokeInvitation(db: Database.Database, id: string) {
  return db.prepare("UPDATE invitation_codes SET revoked_at_utc=? WHERE id=? AND revoked_at_utc IS NULL").run(now(), id).changes > 0;
}

export function registerWithInvitation(db: Database.Database, input: { username?: unknown; password?: unknown; invitationCode?: unknown }): AuthUser {
  const { username, password } = validateCredentials(input.username, input.password);
  const code = String(input.invitationCode ?? "").trim().toUpperCase();
  if (!/^TL-[A-F0-9]{24}$/.test(code)) throw new Error("INVITATION_INVALID_OR_EXPIRED");
  const user: AuthUser = { id: randomUUID(), username, role: "USER" };
  const register = db.transaction(() => {
    const invitation = db.prepare("SELECT id,max_uses,uses,expires_at_utc,revoked_at_utc FROM invitation_codes WHERE code_hash=?").get(hashToken(code)) as { id: string; max_uses: number; uses: number; expires_at_utc: string | null; revoked_at_utc: string | null } | undefined;
    if (!invitation || invitation.revoked_at_utc || invitation.uses >= invitation.max_uses || (invitation.expires_at_utc && new Date(invitation.expires_at_utc).getTime() <= Date.now())) throw new Error("INVITATION_INVALID_OR_EXPIRED");
    const consumed = db.prepare("UPDATE invitation_codes SET uses=uses+1 WHERE id=? AND uses < max_uses AND revoked_at_utc IS NULL").run(invitation.id);
    if (consumed.changes !== 1) throw new Error("INVITATION_INVALID_OR_EXPIRED");
    try {
      db.prepare("INSERT INTO users (id,username,password_hash,role,created_at_utc) VALUES (?,?,?,?,?)").run(user.id, user.username, hashPassword(password), user.role, now());
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new Error("USERNAME_TAKEN");
      throw error;
    }
  });
  register();
  return user;
}
