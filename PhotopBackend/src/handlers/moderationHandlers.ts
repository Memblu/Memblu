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

export function handlePostWebhook(body: any, currentUser: UserRecord | null = null): any {
  if (body && body.Webhook === "Report" && body.Details) {
    const details = body.Details;
    const type = ["User", "Post", "Chat"].includes(details.Type) ? details.Type : "User";
    const contentId = details.ReportContentID;
    const reason = String(details.Reason || "Other").slice(0, 500);

    if (contentId) {
      const reporterId = currentUser ? currentUser.id : null;
      const duplicate = reporterId
        ? db.prepare(`
            SELECT id FROM reports
            WHERE reporter_id = ? AND content_type = ? AND content_id = ? AND status = 'open'
          `).get(reporterId, type, contentId)
        : null;

      if (!duplicate) {
        const snapshot: any = { Type: type, ContentID: contentId };
        if (type === "User") {
          const target = db.prepare(`
            SELECT id, user, role, status, creation_time, ban_data FROM users WHERE id = ?
          `).get(contentId) as any;
          if (target) {
            snapshot.TargetUserID = target.id;
            snapshot.TargetUser = target.user;
            snapshot.TargetRole = target.role;
            snapshot.TargetStatus = target.status;
            snapshot.TargetCreated = target.creation_time;
          }
        } else if (type === "Post") {
          const post = db.prepare(`
            SELECT p.id, p.user_id, p.text, p.timestamp, p.deleted, u.user, u.role
            FROM posts p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?
          `).get(contentId) as any;
          if (post) {
            snapshot.TargetUserID = post.user_id;
            snapshot.TargetUser = post.user;
            snapshot.TargetRole = post.role;
            snapshot.Text = post.text;
            snapshot.Timestamp = post.timestamp;
            snapshot.Removed = post.deleted === 1;
          }
        } else if (type === "Chat") {
          const chat = db.prepare(`
            SELECT c.id, c.post_id, c.user_id, c.text, c.timestamp, c.hidden, u.user, u.role
            FROM chats c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?
          `).get(contentId) as any;
          if (chat) {
            snapshot.TargetUserID = chat.user_id;
            snapshot.TargetUser = chat.user;
            snapshot.TargetRole = chat.role;
            snapshot.Text = chat.text;
            snapshot.PostID = chat.post_id;
            snapshot.Timestamp = chat.timestamp;
            snapshot.Removed = chat.hidden === 1;
          }
        }

        db.prepare(`
          INSERT INTO reports
            (id, reporter_id, content_type, content_id, reason, snapshot, status, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
        `).run(generateId(), reporterId, type, contentId, reason, JSON.stringify(snapshot), Date.now());
      }
    }
  }

  console.log("[Webhook/Report Received]:", JSON.stringify(body));
  return { Code: 200 };
}
