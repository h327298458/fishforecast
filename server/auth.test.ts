import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./db/applyMigrations.js";
import { authenticate, createInvitation, createSession, getSessionUser, hashPassword, registerWithInvitation, revokeInvitation, verifyPassword } from "./auth.js";

describe("invitation authentication", () => {
  const setup = () => { const db = new Database(":memory:"); applyMigrations(db); db.prepare("INSERT INTO users (id,username,password_hash,role,created_at_utc) VALUES ('admin-id','admin',?,'ADMIN',?)").run(hashPassword("admin-test-password"), new Date().toISOString()); return db; };
  it("hashes passwords and authenticates without storing plaintext", () => { expect(verifyPassword("admin-test-password", hashPassword("admin-test-password"))).toBe(true); expect(authenticate(setup(), "admin", "admin-test-password")?.role).toBe("ADMIN"); });
  it("requires an active invitation and consumes its configured use", () => { const db = setup(); const invite = createInvitation(db, "admin-id", { maxUses: 1 }); const user = registerWithInvitation(db, { username: "angler.one", password: "securepass10", invitationCode: invite.code }); expect(user.role).toBe("USER"); expect(() => registerWithInvitation(db, { username: "angler.two", password: "securepass10", invitationCode: invite.code })).toThrow("INVITATION_INVALID_OR_EXPIRED"); });
  it("revokes invitations and stores only session token hashes", () => { const db = setup(); const invite = createInvitation(db, "admin-id", {}); expect(revokeInvitation(db, invite.id)).toBe(true); expect(() => registerWithInvitation(db, { username: "angler.one", password: "securepass10", invitationCode: invite.code })).toThrow("INVITATION_INVALID_OR_EXPIRED"); const session = createSession(db, "admin-id"); expect(getSessionUser(db, session.token)).toEqual(expect.objectContaining({ username: "admin" })); expect((db.prepare("SELECT token_hash FROM user_sessions").get() as { token_hash: string }).token_hash).not.toBe(session.token); });
});
