import { db } from "../db.js";
import { hashPassword, verifyPassword } from "../auth.js";
import { UserRecord, SessionRecord } from "../types.js";

export function handleUpdateAccountData(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401 };

  const { Update = [] } = body;
  let settings = JSON.parse(currentUser.settings || "{}");
  let profileData = JSON.parse(currentUser.profile_data || "{}");
  let newUsername = currentUser.user;
  let newEmail = currentUser.email;
  let newPassHash = currentUser.password_hash;

  for (const item of Update) {
    if (item.Change === "Password") {
      if (!verifyPassword(item.OldPass, currentUser.password_hash)) {
        return { Code: 403, Message: "Password incorrect." };
      }
      newPassHash = hashPassword(item.NewPass);
    } else if (item.Change === "Username" && item.Username) {
      const u = item.Username.trim();
      if (u.length >= 3 && u.length <= 16 && /^[A-Za-z0-9_-]+$/.test(u)) {
        const existing = db.prepare("SELECT id FROM users WHERE user_lower = ? AND id != ?").get(u.toLowerCase(), currentUser.id);
        if (!existing) {
          newUsername = u;
        }
      }
    } else if (item.Change === "Email" && item.Email) {
      newEmail = item.Email.trim().toLowerCase();
    } else if (item.Change === "ProfileDescription") {
      profileData.Description = item.NewText || "";
    } else if (item.Change === "DisplaySettings") {
      settings.Display = item.NewSettings;
    }
  }

  db.prepare(`
    UPDATE users
    SET user = ?, user_lower = ?, email = ?, password_hash = ?, settings = ?, profile_data = ?
    WHERE id = ?
  `).run(
    newUsername,
    newUsername.toLowerCase(),
    newEmail,
    newPassHash,
    JSON.stringify(settings),
    JSON.stringify(profileData),
    currentUser.id
  );

  return {
    Code: 200,
    Settings: settings
  };
}

export function handleGetActiveDevices(currentUser: UserRecord | null, clientIp: string): any {
  if (!currentUser) return { Code: 401 };

  const sessions = db.prepare(`
    SELECT ip, last_visit FROM sessions WHERE user_id = ? ORDER BY last_visit DESC
  `).all(currentUser.id) as unknown as SessionRecord[];

  const devices = sessions.map(s => ({
    IP: s.ip,
    LastVisit: s.last_visit,
    IsUser: s.ip === clientIp ? true : undefined
  }));

  return { Code: 200, Devices: devices };
}

export function handleSignOutSession(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401 };
  const { SessionIP } = body;
  if (SessionIP) {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND ip = ?").run(currentUser.id, SessionIP);
  }
  return { Code: 200 };
}

export function handleManageAccount(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401 };
  const { Type } = body;

  if (Type === "Disable") {
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(currentUser.id);
  } else if (Type === "Delete") {
    db.prepare("UPDATE users SET status = 'pending_delete', delete_timeframe = 2592000 WHERE id = ?").run(currentUser.id);
  } else if (Type === "Recover") {
    db.prepare("UPDATE users SET status = 'active', delete_timeframe = NULL WHERE id = ?").run(currentUser.id);
  }

  return { Code: 200 };
}

export function handleAddBlockedUser(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401 };
  const { BlockUser } = body;
  if (!BlockUser) return { Code: 400 };

  const blocked: string[] = JSON.parse(currentUser.blocked_users || "[]");
  if (!blocked.includes(BlockUser)) {
    blocked.push(BlockUser);
    db.prepare("UPDATE users SET blocked_users = ? WHERE id = ?").run(JSON.stringify(blocked), currentUser.id);
  }

  return { Code: 200, BlockedUsers: blocked };
}

export function handleGetBlockedUsers(currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401 };

  const blocked: string[] = JSON.parse(currentUser.blocked_users || "[]");
  if (blocked.length === 0) {
    return { Code: 200, BlockedUsers: [] };
  }

  const placeholders = blocked.map(() => "?").join(",");
  const userRows = db.prepare(`SELECT id, user, role, settings FROM users WHERE id IN (${placeholders})`).all(...blocked) as any[];

  const list = userRows.map(u => ({
    _id: u.id,
    User: u.user,
    Role: u.role,
    Settings: JSON.parse(u.settings || "{}")
  }));

  return { Code: 200, BlockedUsers: list };
}

export function handleUnblockUsers(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401 };
  const { UnblockUsers = [] } = body;

  let blocked: string[] = JSON.parse(currentUser.blocked_users || "[]");
  blocked = blocked.filter(id => !UnblockUsers.includes(id));
  db.prepare("UPDATE users SET blocked_users = ? WHERE id = ?").run(JSON.stringify(blocked), currentUser.id);

  return { Code: 200, BlockedUsers: blocked };
}
