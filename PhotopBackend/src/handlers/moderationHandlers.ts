import { db } from "../db.js";
import { generateId } from "../auth.js";
import { UserRecord } from "../types.js";

export function handleModerateUserAction(
  body: any,
  currentUser: UserRecord | null,
  pushBanToUser: (userId: string, banData: any) => void
): any {
  if (!currentUser) return { Code: 401 };

  const isMod = currentUser.role === "Owner" || currentUser.role === "Moderator";
  if (!isMod) return { Code: 403, Message: "Permission denied." };

  const { Task, Data } = body;
  if (Task === "Ban" && Data && Data.UserID) {
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(Data.UserID) as UserRecord | undefined;
    if (!target) return { Code: 404, Message: "Target user not found." };

    let expires: string | number = "Permanent";
    if (typeof Data.BanLength === "number") {
      expires = Date.now() + (Data.BanLength * 1000);
    }

    const banInfo = {
      Account: target.user,
      BanReason: Data.Reason || "Violating community guidelines.",
      BanExpires: expires,
      Appealed: false
    };

    db.prepare(`
      UPDATE users SET status = 'banned', ban_data = ? WHERE id = ?
    `).run(JSON.stringify(banInfo), target.id);

    if (Data.TerminateAccount) {
      db.prepare("UPDATE posts SET deleted = 1 WHERE user_id = ?").run(target.id);
      db.prepare("UPDATE chats SET hidden = 1 WHERE user_id = ?").run(target.id);
    }

    pushBanToUser(target.id, banInfo);

    return { Code: 200 };
  }

  return { Code: 200 };
}

export function handleSendBanAppeal(body: any, currentUser: UserRecord | null): any {
  const { Appeal } = body;
  if (!Appeal) return { Code: 400 };

  const appealId = generateId();
  const userId = currentUser ? currentUser.id : "anonymous";
  const now = Date.now();

  db.prepare(`
    INSERT INTO ban_appeals (id, user_id, appeal, timestamp)
    VALUES (?, ?, ?, ?)
  `).run(appealId, userId, Appeal, now);

  if (currentUser) {
    const banData = JSON.parse(currentUser.ban_data || "{}");
    banData.Appealed = true;
    db.prepare("UPDATE users SET ban_data = ? WHERE id = ?").run(JSON.stringify(banData), currentUser.id);
  }

  return { Code: 200 };
}

export function handleUnbanUser(body: any, currentUser: UserRecord | null): any {
  if (!currentUser || currentUser.role !== "Owner") {
    return { Code: 403, Message: "Only the owner can unban users." };
  }

  const { UserID } = body;
  if (!UserID) return { Code: 400 };

  db.prepare("UPDATE users SET status = 'active', ban_data = NULL WHERE id = ?").run(UserID);
  return { Code: 200 };
}

export function handlePostWebhook(body: any): any {
  console.log("[Webhook/Report Received]:", JSON.stringify(body));
  return { Code: 200 };
}
