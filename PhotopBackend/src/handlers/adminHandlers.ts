import { db } from "../db.js";
import { generateId } from "../auth.js";
import { UserRecord } from "../types.js";
import { notifyContentModerated, removeNotificationsForChat, removeNotificationsForContent, removeNotificationsForPost } from "../notifications.js";

const VALID_ROLES = [
  "Owner",
  "Moderator",
  "Developer",
  "Contributor",
  "Verified",
  "Partner",
  "Tester",
  "User"
];

const DAY = 24 * 60 * 60 * 1000;

function parseJson(value: string | null | undefined, fallback: any = null): any {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function parseRoles(role: any): string[] {
  if (role == null) return [];
  if (Array.isArray(role)) return role.map(String);
  const text = String(role).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Fall through to the simple string handling below.
    }
  }
  if (text.includes(",")) {
    return text.split(",").map(part => part.trim()).filter(Boolean);
  }
  return [text];
}

function isStaff(user: UserRecord | null): boolean {
  if (!user) return false;
  const roles = parseRoles(user.role);
  return roles.includes("Owner") || roles.includes("Moderator");
}

function isOwner(user: UserRecord | null): boolean {
  return !!user && parseRoles(user.role).includes("Owner");
}

function guardStaff(currentUser: UserRecord | null): any | null {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  if (!isStaff(currentUser)) return { Code: 403, Message: "Admin access required." };
  return null;
}

function guardOwner(currentUser: UserRecord | null): any | null {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  if (!isOwner(currentUser)) return { Code: 403, Message: "Only the Owner can do that." };
  return null;
}

function logAdminAction(actor: UserRecord, action: string, target: string | null, details: any): void {
  db.prepare(`
    INSERT INTO admin_log (id, actor_id, action, target, details, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(generateId(), actor.id, action, target, details == null ? null : JSON.stringify(details), Date.now());
}

function countRows(sql: string, ...params: any[]): number {
  const row = db.prepare(sql).get(...params) as { c?: number } | undefined;
  return Number(row?.c || 0);
}

function pagination(body: any): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Math.floor(Number(body?.Page) || 1));
  const limit = Math.min(100, Math.max(5, Math.floor(Number(body?.Limit) || 25)));
  return { page, limit, offset: (page - 1) * limit };
}

function pagesFor(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / limit));
}

function formatUserRow(row: any): any {
  return {
    _id: row.id,
    User: row.user,
    Email: row.email,
    Role: row.role,
    Status: row.status,
    CreationTime: row.creation_time,
    SetLocation: row.set_location || null,
    BanData: parseJson(row.ban_data),
    PostCount: Number(row.post_count || 0),
    ChatCount: Number(row.chat_count || 0),
    SessionCount: Number(row.session_count || 0),
    LastSeen: row.last_seen || null,
    OpenReports: Number(row.report_count || 0)
  };
}

function formatReportRow(row: any): any {
  return {
    _id: row.id,
    ReporterID: row.reporter_id,
    Reporter: row.reporter_name || null,
    ReporterRole: row.reporter_role || null,
    Type: row.content_type,
    ContentID: row.content_id,
    Reason: row.reason,
    Snapshot: parseJson(row.snapshot, {}),
    Status: row.status,
    Timestamp: row.timestamp,
    ReviewedBy: row.reviewed_by || null,
    ReviewedAt: row.reviewed_at || null,
    ResolutionNote: row.resolution_note || null
  };
}

function deleteContentByType(type: string, id: string): { DeletedPostIDs?: string[]; DeletedChatIDs?: string[] } {
  if (type === "Post") {
    const post = db.prepare("SELECT id, deleted FROM posts WHERE id = ?").get(id) as any;
    if (!post) return {};
    if (post.deleted !== 1) {
      db.prepare("UPDATE posts SET deleted = 1 WHERE id = ?").run(id);
      db.prepare("UPDATE users SET profile_data = replace(profile_data, ?, '') WHERE profile_data LIKE ?")
        .run(`"PinnedPost":"${id}"`, `%"PinnedPost":"${id}"%`);
      removeNotificationsForPost(id);
    }
    return { DeletedPostIDs: [id] };
  }
  if (type === "Chat") {
    const chat = db.prepare("SELECT id, post_id, hidden FROM chats WHERE id = ?").get(id) as any;
    if (!chat) return {};
    if (chat.hidden !== 1) {
      db.prepare("UPDATE chats SET hidden = 1 WHERE id = ?").run(id);
      db.prepare("UPDATE posts SET chats = MAX(0, chats - 1) WHERE id = ?").run(chat.post_id);
      removeNotificationsForChat(id);
    }
    return { DeletedChatIDs: [id] };
  }
  return {};
}

export function handleAdminOverview(currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;

  const now = Date.now();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const weekAgo = now - 7 * DAY;

  const stats = {
    Users: countRows("SELECT COUNT(*) AS c FROM users"),
    ActiveUsers: countRows(
      "SELECT COUNT(DISTINCT user_id) AS c FROM sessions WHERE expires_at > strftime('%s','now')"
    ),
    BannedUsers: countRows("SELECT COUNT(*) AS c FROM users WHERE status = 'banned'"),
    DisabledUsers: countRows("SELECT COUNT(*) AS c FROM users WHERE status = 'disabled'"),
    PendingDeletion: countRows("SELECT COUNT(*) AS c FROM users WHERE status = 'pending_delete'"),
    Staff: countRows(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'Owner' OR role = 'Moderator' OR role LIKE '%\"Owner\"%' OR role LIKE '%\"Moderator\"%'"
    ),
    Posts: countRows("SELECT COUNT(*) AS c FROM posts WHERE deleted = 0"),
    DeletedPosts: countRows("SELECT COUNT(*) AS c FROM posts WHERE deleted = 1"),
    Chats: countRows("SELECT COUNT(*) AS c FROM chats WHERE hidden = 0"),
    HiddenChats: countRows("SELECT COUNT(*) AS c FROM chats WHERE hidden = 1"),
    Likes: countRows("SELECT COUNT(*) AS c FROM likes") + countRows("SELECT COUNT(*) AS c FROM chat_likes"),
    Follows: countRows("SELECT COUNT(*) AS c FROM follows"),
    OpenReports: countRows("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'"),
    TotalReports: countRows("SELECT COUNT(*) AS c FROM reports"),
    PendingAppeals: countRows("SELECT COUNT(*) AS c FROM ban_appeals WHERE handled = 0"),
    NewUsersToday: countRows("SELECT COUNT(*) AS c FROM users WHERE creation_time >= ?", todayStart),
    PostsToday: countRows("SELECT COUNT(*) AS c FROM posts WHERE timestamp >= ? AND deleted = 0", todayStart),
    ChatsToday: countRows("SELECT COUNT(*) AS c FROM chats WHERE timestamp >= ? AND hidden = 0", todayStart),
    NewUsersThisWeek: countRows("SELECT COUNT(*) AS c FROM users WHERE creation_time >= ?", weekAgo),
    PostsThisWeek: countRows("SELECT COUNT(*) AS c FROM posts WHERE timestamp >= ? AND deleted = 0", weekAgo),
    ChatsThisWeek: countRows("SELECT COUNT(*) AS c FROM chats WHERE timestamp >= ? AND hidden = 0", weekAgo)
  };

  const postActivity = db.prepare(`
    SELECT strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch') AS day, COUNT(*) AS c
    FROM posts WHERE timestamp >= ? AND deleted = 0 GROUP BY day
  `).all(now - 6 * DAY) as any[];
  const chatActivity = db.prepare(`
    SELECT strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch') AS day, COUNT(*) AS c
    FROM chats WHERE timestamp >= ? AND hidden = 0 GROUP BY day
  `).all(now - 6 * DAY) as any[];
  const userActivity = db.prepare(`
    SELECT strftime('%Y-%m-%d', creation_time / 1000, 'unixepoch') AS day, COUNT(*) AS c
    FROM users WHERE creation_time >= ? GROUP BY day
  `).all(now - 6 * DAY) as any[];

  function activityMap(rows: any[]): Record<string, number> {
    const map: Record<string, number> = {};
    for (const row of rows) map[row.day] = Number(row.c || 0);
    return map;
  }
  const postMap = activityMap(postActivity);
  const chatMap = activityMap(chatActivity);
  const userMap = activityMap(userActivity);
  const activity: any[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now - i * DAY).toISOString().slice(0, 10);
    activity.push({
      Date: date,
      Posts: postMap[date] || 0,
      Chats: chatMap[date] || 0,
      Users: userMap[date] || 0
    });
  }

  const topPosters = (db.prepare(`
    SELECT u.id, u.user, u.role, COUNT(p.id) AS c
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.deleted = 0 AND p.timestamp >= ?
    GROUP BY u.id ORDER BY c DESC LIMIT 5
  `).all(weekAgo) as any[]).map(row => ({
    _id: row.id,
    User: row.user,
    Role: row.role,
    Count: Number(row.c || 0)
  }));

  const recentActions = (db.prepare(`
    SELECT l.*, u.user AS actor_name, u.role AS actor_role
    FROM admin_log l LEFT JOIN users u ON u.id = l.actor_id
    ORDER BY l.timestamp DESC LIMIT 8
  `).all() as any[]).map(row => ({
    _id: row.id,
    Actor: row.actor_name || "Unknown",
    ActorRole: row.actor_role || null,
    Action: row.action,
    Target: row.target || null,
    Details: parseJson(row.details),
    Timestamp: row.timestamp
  }));

  return {
    Code: 200,
    Stats: stats,
    Activity: activity,
    TopPosters: topPosters,
    RecentActions: recentActions,
    System: {
      Node: process.version,
      Uptime: Math.floor(process.uptime()),
      MemoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      Time: now
    }
  };
}

export function handleAdminGetUsers(body: any, currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;

  const { page, limit, offset } = pagination(body);
  const conditions: string[] = [];
  const params: any[] = [];
  const search = String(body?.Search || "").trim().toLowerCase();

  if (search) {
    conditions.push("(u.user_lower LIKE ? OR u.email LIKE ? OR u.id = ?)");
    params.push(`%${search}%`, `%${search}%`, search);
  }

  const filter = String(body?.Filter || "All");
  if (filter === "Staff") {
    conditions.push("(u.role = 'Owner' OR u.role = 'Moderator' OR u.role LIKE '%\"Owner\"%' OR u.role LIKE '%\"Moderator\"%')");
  } else if (filter === "Banned") {
    conditions.push("u.status = 'banned'");
  } else if (filter === "Disabled") {
    conditions.push("u.status = 'disabled'");
  } else if (filter === "Active") {
    conditions.push("u.status = 'active'");
  } else if (filter === "PendingDelete") {
    conditions.push("u.status = 'pending_delete'");
  } else if (filter === "Reported") {
    conditions.push("EXISTS (SELECT 1 FROM reports r WHERE r.content_type = 'User' AND r.content_id = u.id AND r.status = 'open')");
  }

  const roleFilter = String(body?.Role || "");
  if (roleFilter && roleFilter !== "All" && VALID_ROLES.includes(roleFilter)) {
    conditions.push("u.role = ?");
    params.push(roleFilter);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sortKey = String(body?.Sort || "Newest");
  const orderBy =
    sortKey === "Oldest" ? "u.creation_time ASC" :
    sortKey === "Name" ? "u.user_lower ASC" :
    sortKey === "Posts" ? "post_count DESC, u.creation_time DESC" :
    sortKey === "Chats" ? "chat_count DESC, u.creation_time DESC" :
    sortKey === "LastSeen" ? "last_seen DESC" :
    sortKey === "Reports" ? "report_count DESC, u.creation_time DESC" :
    "u.creation_time DESC";

  const total = countRows(`SELECT COUNT(*) AS c FROM users u ${where}`, ...params);
  const rows = db.prepare(`
    SELECT
      u.id, u.user, u.email, u.role, u.status, u.creation_time, u.ban_data, u.set_location,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.deleted = 0) AS post_count,
      (SELECT COUNT(*) FROM chats c WHERE c.user_id = u.id AND c.hidden = 0) AS chat_count,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > strftime('%s','now')) AS session_count,
      (SELECT MAX(s.last_visit) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
      (SELECT COUNT(*) FROM reports r WHERE r.content_type = 'User' AND r.content_id = u.id AND r.status = 'open') AS report_count
    FROM users u
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  return {
    Code: 200,
    Users: rows.map(formatUserRow),
    Total: total,
    Page: page,
    Pages: pagesFor(total, limit),
    Limit: limit
  };
}

export function handleAdminGetUser(body: any, currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;

  const userId = body?.UserID;
  if (!userId) return { Code: 400, Message: "Missing UserID." };

  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRecord | undefined;
  if (!target) return { Code: 404, Message: "User not found." };

  const posts = db.prepare(`
    SELECT * FROM posts WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10
  `).all(userId) as any[];
  const chats = db.prepare(`
    SELECT c.*, p.text AS post_text FROM chats c
    LEFT JOIN posts p ON p.id = c.post_id
    WHERE c.user_id = ? ORDER BY c.timestamp DESC LIMIT 10
  `).all(userId) as any[];
  const reports = db.prepare(`
    SELECT r.*, u.user AS reporter_name, u.role AS reporter_role
    FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
    WHERE (r.content_type = 'User' AND r.content_id = ?)
       OR (r.content_type = 'Post' AND r.content_id IN (SELECT id FROM posts WHERE user_id = ?))
       OR (r.content_type = 'Chat' AND r.content_id IN (SELECT id FROM chats WHERE user_id = ?))
    ORDER BY r.timestamp DESC LIMIT 10
  `).all(userId, userId, userId) as any[];
  const appeals = db.prepare(`
    SELECT * FROM ban_appeals WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10
  `).all(userId) as any[];
  const sessions = db.prepare(`
    SELECT ip, MIN(last_visit) AS first_seen, MAX(last_visit) AS last_seen, MAX(expires_at) AS expires_at, COUNT(*) AS count
    FROM sessions WHERE user_id = ? GROUP BY ip ORDER BY last_seen DESC LIMIT 10
  `).all(userId) as any[];

  const stats = {
    Posts: countRows("SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND deleted = 0", userId),
    DeletedPosts: countRows("SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND deleted = 1", userId),
    Chats: countRows("SELECT COUNT(*) AS c FROM chats WHERE user_id = ? AND hidden = 0", userId),
    HiddenChats: countRows("SELECT COUNT(*) AS c FROM chats WHERE user_id = ? AND hidden = 1", userId),
    LikesGiven: countRows("SELECT COUNT(*) AS c FROM likes WHERE user_id = ?", userId) + countRows("SELECT COUNT(*) AS c FROM chat_likes WHERE user_id = ?", userId),
    Followers: countRows("SELECT COUNT(*) AS c FROM follows WHERE target_id = ?", userId),
    Following: countRows("SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?", userId),
    Sessions: countRows("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND expires_at > strftime('%s','now')", userId),
    OpenReports: countRows("SELECT COUNT(*) AS c FROM reports WHERE status = 'open' AND ((content_type = 'User' AND content_id = ?) OR (content_type = 'Post' AND content_id IN (SELECT id FROM posts WHERE user_id = ?)) OR (content_type = 'Chat' AND content_id IN (SELECT id FROM chats WHERE user_id = ?)))", userId, userId, userId)
  };

  return {
    Code: 200,
    User: formatUserRow(target),
    Stats: stats,
    Posts: posts.map(post => ({
      _id: post.id,
      Text: post.text,
      Timestamp: post.timestamp,
      Likes: post.likes,
      Chats: post.chats,
      Removed: post.deleted === 1
    })),
    Chats: chats.map(chat => ({
      _id: chat.id,
      PostID: chat.post_id,
      PostText: chat.post_text || null,
      Text: chat.text,
      Timestamp: chat.timestamp,
      Likes: chat.likes,
      Removed: chat.hidden === 1
    })),
    Reports: reports.map(formatReportRow),
    Appeals: appeals.map(appeal => ({
      _id: appeal.id,
      Appeal: appeal.appeal,
      Timestamp: appeal.timestamp,
      Handled: appeal.handled === 1,
      AdminNote: appeal.admin_note || null,
      ReviewedBy: appeal.reviewed_by || null,
      ReviewedAt: appeal.reviewed_at || null
    })),
    Sessions: sessions.map(session => ({
      IP: session.ip,
      FirstSeen: session.first_seen,
      LastSeen: session.last_seen,
      ExpiresAt: session.expires_at,
      Count: Number(session.count || 0)
    }))
  };
}

export function handleAdminUpdateUser(body: any, currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;
  if (!currentUser) return { Code: 401 };

  const userId = body?.UserID;
  const task = String(body?.Task || "");
  if (!userId || !task) return { Code: 400, Message: "Missing UserID or Task." };

  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRecord | undefined;
  if (!target) return { Code: 404, Message: "User not found." };

  const targetRoles = parseRoles(target.role);
  const targetIsOwner = targetRoles.includes("Owner");
  const self = target.id === currentUser.id;

  if (targetIsOwner && !isOwner(currentUser)) {
    return { Code: 403, Message: "Only an Owner can manage another Owner." };
  }

  if (task === "Role") {
    const ownerDenied = guardOwner(currentUser);
    if (ownerDenied) return ownerDenied;
    const role = String(body?.Role || "");
    if (!VALID_ROLES.includes(role)) {
      return { Code: 400, Message: "Invalid role." };
    }
    if (targetIsOwner && role !== "Owner") {
      const owners = (db.prepare("SELECT role FROM users").all() as any[])
        .filter(row => parseRoles(row.role).includes("Owner")).length;
      if (owners <= 1) {
        return { Code: 400, Message: "You cannot remove the last Owner." };
      }
    }
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, target.id);
    logAdminAction(currentUser, "RoleChanged", target.user, { From: target.role, To: role });
    // Respond with TargetUserID rather than UserID: clients treat a top-level
    // UserID as the signed-in account and would switch identity mid-session.
    return { Code: 200, TargetUserID: target.id, Role: role };
  }

  if (task === "Ban") {
    if (targetIsOwner) return { Code: 403, Message: "Owners cannot be banned." };
    if (self) return { Code: 400, Message: "You cannot ban yourself." };

    const rawLength = body?.BanLength;
    let expires: string | number = "Permanent";
    if (typeof rawLength === "number" && rawLength > 0) {
      expires = Date.now() + rawLength * 1000;
    } else if (typeof rawLength === "string" && /^\d+$/.test(rawLength) && Number(rawLength) > 0) {
      expires = Date.now() + Number(rawLength) * 1000;
    }

    const banInfo = {
      Account: target.user,
      BanReason: String(body?.Reason || "Violating community guidelines.").slice(0, 500),
      BanExpires: expires,
      Appealed: false,
      BannedBy: currentUser.user,
      BannedAt: Date.now()
    };

    db.prepare("UPDATE users SET status = 'banned', ban_data = ? WHERE id = ?")
      .run(JSON.stringify(banInfo), target.id);

    let deletedPostIDs: string[] | undefined;
    let deletedChatIDs: string[] | undefined;
    if (body?.TerminateAccount) {
      deletedPostIDs = (db.prepare("SELECT id FROM posts WHERE user_id = ? AND deleted = 0").all(target.id) as any[]).map(row => row.id);
      deletedChatIDs = (db.prepare("SELECT id FROM chats WHERE user_id = ? AND hidden = 0").all(target.id) as any[]).map(row => row.id);
      db.prepare("UPDATE posts SET deleted = 1 WHERE user_id = ?").run(target.id);
      db.prepare("UPDATE chats SET hidden = 1 WHERE user_id = ?").run(target.id);
      db.prepare("UPDATE users SET profile_data = replace(profile_data, '\"PinnedPost\"', '\"PinnedPostRemoved\"') WHERE id = ?").run(target.id);
      removeNotificationsForContent({ postIds: deletedPostIDs, chatIds: deletedChatIDs });
    }

    logAdminAction(currentUser, "UserBanned", target.user, {
      Reason: banInfo.BanReason,
      Expires: banInfo.BanExpires,
      Terminated: !!body?.TerminateAccount
    });

    return {
      Code: 200,
      TargetUserID: target.id,
      BanTarget: { UserID: target.id, BanData: banInfo },
      RevokeSessionsFor: target.id,
      DeletedPostIDs: deletedPostIDs,
      DeletedChatIDs: deletedChatIDs
    };
  }

  if (task === "Unban") {
    const ownerDenied = guardOwner(currentUser);
    if (ownerDenied) return ownerDenied;
    db.prepare("UPDATE users SET status = 'active', ban_data = NULL WHERE id = ?").run(target.id);
    logAdminAction(currentUser, "UserUnbanned", target.user, {});
    return { Code: 200, TargetUserID: target.id };
  }

  if (task === "Disable" || task === "Enable") {
    const ownerDenied = guardOwner(currentUser);
    if (ownerDenied) return ownerDenied;
    if (task === "Disable" && self) return { Code: 400, Message: "You cannot disable yourself." };
    const status = task === "Disable" ? "disabled" : "active";
    db.prepare("UPDATE users SET status = ?, ban_data = NULL WHERE id = ?").run(status, target.id);
    logAdminAction(currentUser, task === "Disable" ? "UserDisabled" : "UserEnabled", target.user, {});
    return {
      Code: 200,
      TargetUserID: target.id,
      RevokeSessionsFor: task === "Disable" ? target.id : undefined
    };
  }

  if (task === "SignOut") {
    if (targetIsOwner && !isOwner(currentUser)) {
      return { Code: 403, Message: "Only an Owner can sign out another Owner." };
    }
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    logAdminAction(currentUser, "UserSignedOut", target.user, {});
    return { Code: 200, TargetUserID: target.id, RevokeSessionsFor: target.id };
  }

  if (task === "PurgeContent") {
    const deletedPostIDs = (db.prepare("SELECT id FROM posts WHERE user_id = ? AND deleted = 0").all(target.id) as any[]).map(row => row.id);
    const deletedChatIDs = (db.prepare("SELECT id FROM chats WHERE user_id = ? AND hidden = 0").all(target.id) as any[]).map(row => row.id);
    db.prepare("UPDATE posts SET deleted = 1 WHERE user_id = ?").run(target.id);
    db.prepare("UPDATE chats SET hidden = 1 WHERE user_id = ?").run(target.id);
    db.prepare("UPDATE users SET profile_data = replace(profile_data, '\"PinnedPost\"', '\"PinnedPostRemoved\"') WHERE id = ?").run(target.id);
    removeNotificationsForContent({ postIds: deletedPostIDs, chatIds: deletedChatIDs });
    logAdminAction(currentUser, "ContentPurged", target.user, {
      Posts: deletedPostIDs.length,
      Chats: deletedChatIDs.length
    });
    return { Code: 200, TargetUserID: target.id, DeletedPostIDs: deletedPostIDs, DeletedChatIDs: deletedChatIDs };
  }

  return { Code: 400, Message: `Unknown user task ${task}.` };
}

export function handleAdminGetContent(body: any, currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;

  const type = body?.Type === "Chats" ? "Chats" : "Posts";
  const { page, limit, offset } = pagination(body);
  const search = String(body?.Search || "").trim().toLowerCase();
  const filter = String(body?.Filter || "All");
  const conditions: string[] = [];
  const params: any[] = [];

  if (search) {
    if (type === "Posts") {
      conditions.push("(LOWER(p.text) LIKE ? OR u.user_lower LIKE ? OR p.id = ?)");
    } else {
      conditions.push("(LOWER(c.text) LIKE ? OR u.user_lower LIKE ? OR c.id = ? OR c.post_id = ?)");
    }
    params.push(`%${search}%`, `%${search}%`, search);
    if (type === "Chats") params.push(search);
  }

  if (type === "Posts") {
    if (filter === "Active") conditions.push("p.deleted = 0");
    else if (filter === "Deleted") conditions.push("p.deleted = 1");
  } else {
    if (filter === "Active") conditions.push("c.hidden = 0");
    else if (filter === "Deleted" || filter === "Hidden") conditions.push("c.hidden = 1");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sort = String(body?.Sort || "Newest") === "Oldest" ? "ASC" : "DESC";

  if (type === "Posts") {
    const total = countRows(`
      SELECT COUNT(*) AS c FROM posts p LEFT JOIN users u ON u.id = p.user_id ${where}
    `, ...params);
    const rows = db.prepare(`
      SELECT p.*, u.user AS author_name, u.role AS author_role
      FROM posts p LEFT JOIN users u ON u.id = p.user_id
      ${where}
      ORDER BY p.timestamp ${sort}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return {
      Code: 200,
      Type: "Posts",
      Items: rows.map(row => ({
        Type: "Post",
        _id: row.id,
        UserID: row.user_id,
        Author: row.author_name || "Unknown",
        AuthorRole: row.author_role || null,
        Text: row.text,
        Timestamp: row.timestamp,
        Likes: row.likes,
        Chats: row.chats,
        HasMedia: !!row.media,
        Removed: row.deleted === 1
      })),
      Total: total,
      Page: page,
      Pages: pagesFor(total, limit),
      Limit: limit
    };
  }

  const total = countRows(`
    SELECT COUNT(*) AS c FROM chats c LEFT JOIN users u ON u.id = c.user_id ${where}
  `, ...params);
  const rows = db.prepare(`
    SELECT c.*, u.user AS author_name, u.role AS author_role
    FROM chats c LEFT JOIN users u ON u.id = c.user_id
    ${where}
    ORDER BY c.timestamp ${sort}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  return {
    Code: 200,
    Type: "Chats",
    Items: rows.map(row => ({
      Type: "Chat",
      _id: row.id,
      PostID: row.post_id,
      UserID: row.user_id,
      Author: row.author_name || "Unknown",
      AuthorRole: row.author_role || null,
      Text: row.text,
      Timestamp: row.timestamp,
      Likes: row.likes,
      Removed: row.hidden === 1
    })),
    Total: total,
    Page: page,
    Pages: pagesFor(total, limit),
    Limit: limit
  };
}

export function handleAdminContentAction(body: any, currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;
  if (!currentUser) return { Code: 401 };

  const task = String(body?.Task || "");
  const type = body?.Type === "Chat" ? "Chat" : "Post";
  const id = body?.ID;
  if (!id) return { Code: 400, Message: "Missing content ID." };

  if (task === "Delete") {
    const result = deleteContentByType(type, id);
    if (!result.DeletedPostIDs && !result.DeletedChatIDs) {
      return { Code: 404, Message: "Content not found." };
    }
    const reason = typeof body?.Reason === "string" && body.Reason.trim()
      ? body.Reason.trim().slice(0, 500)
      : "Removed by a moderator.";
    notifyContentModerated({
      targetType: type === "Chat" ? "Chat" : "Post",
      targetId: id,
      actorId: currentUser.id,
      action: "Removed",
      reason
    });
    logAdminAction(currentUser, type === "Post" ? "PostDeleted" : "ChatDeleted", id, { Reason: reason });
    return { Code: 200, ...result };
  }

  if (task === "Restore") {
    if (type === "Post") {
      const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(id);
      if (!post) return { Code: 404, Message: "Post not found." };
      db.prepare("UPDATE posts SET deleted = 0 WHERE id = ?").run(id);
      logAdminAction(currentUser, "PostRestored", id, {});
      return { Code: 200, RestoredPostIDs: [id] };
    }
    const chat = db.prepare("SELECT id, post_id, hidden FROM chats WHERE id = ?").get(id) as any;
    if (!chat) return { Code: 404, Message: "Chat not found." };
    if (chat.hidden === 1) {
      db.prepare("UPDATE chats SET hidden = 0 WHERE id = ?").run(id);
      db.prepare("UPDATE posts SET chats = chats + 1 WHERE id = ?").run(chat.post_id);
    }
    logAdminAction(currentUser, "ChatRestored", id, {});
    return { Code: 200, RestoredChatIDs: [id] };
  }

  return { Code: 400, Message: "Unknown content task." };
}

export function handleAdminReports(body: any, currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;
  if (!currentUser) return { Code: 401 };

  const task = String(body?.Task || "List");

  if (task === "List") {
    const { page, limit, offset } = pagination(body);
    const conditions: string[] = [];
    const params: any[] = [];
    const status = String(body?.Status || "open");
    if (["open", "resolved", "dismissed"].includes(status)) {
      conditions.push("r.status = ?");
      params.push(status);
    }
    const type = String(body?.Type || "All");
    if (["User", "Post", "Chat"].includes(type)) {
      conditions.push("r.content_type = ?");
      params.push(type);
    }
    const search = String(body?.Search || "").trim().toLowerCase();
    if (search) {
      conditions.push("(LOWER(r.reason) LIKE ? OR LOWER(r.content_id) LIKE ? OR u.user_lower LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = countRows(`
      SELECT COUNT(*) AS c FROM reports r LEFT JOIN users u ON u.id = r.reporter_id ${where}
    `, ...params);
    const rows = db.prepare(`
      SELECT r.*, u.user AS reporter_name, u.role AS reporter_role
      FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
      ${where}
      ORDER BY r.timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return {
      Code: 200,
      Reports: rows.map(formatReportRow),
      Total: total,
      Page: page,
      Pages: pagesFor(total, limit),
      Limit: limit
    };
  }

  if (task === "Update") {
    const reportId = body?.ReportID;
    const status = String(body?.Status || "");
    if (!reportId || !["open", "resolved", "dismissed"].includes(status)) {
      return { Code: 400, Message: "Invalid report update." };
    }
    const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as any;
    if (!report) return { Code: 404, Message: "Report not found." };
    db.prepare(`
      UPDATE reports SET status = ?, reviewed_by = ?, reviewed_at = ?, resolution_note = ? WHERE id = ?
    `).run(status, currentUser.id, Date.now(), body?.Note == null ? null : String(body.Note).slice(0, 500), reportId);
    logAdminAction(currentUser, "ReportUpdated", report.content_id, {
      ReportID: reportId,
      Status: status
    });
    return { Code: 200, ReportID: reportId, Status: status };
  }

  if (task === "DeleteContent") {
    const reportId = body?.ReportID;
    const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as any;
    if (!report) return { Code: 404, Message: "Report not found." };
    const deletion = deleteContentByType(report.content_type, report.content_id);
    if (report.content_type === "Post" || report.content_type === "Chat") {
      notifyContentModerated({
        targetType: report.content_type,
        targetId: report.content_id,
        actorId: currentUser.id,
        action: "Removed",
        reason: String(report.reason || "Removed after a report.").slice(0, 500)
      });
    }
    db.prepare(`
      UPDATE reports SET status = 'resolved', reviewed_by = ?, reviewed_at = ?, resolution_note = ? WHERE id = ?
    `).run(currentUser.id, Date.now(), "Content removed from report.", reportId);
    logAdminAction(currentUser, "ReportContentDeleted", report.content_id, {
      ReportID: reportId,
      Type: report.content_type
    });
    return { Code: 200, ...deletion, ReportID: reportId, Status: "resolved" };
  }

  return { Code: 400, Message: "Unknown reports task." };
}

export function handleAdminAppeals(body: any, currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;
  if (!currentUser) return { Code: 401 };

  const task = String(body?.Task || "List");

  if (task === "List") {
    const { page, limit, offset } = pagination(body);
    const conditions: string[] = [];
    const params: any[] = [];
    const status = String(body?.Status || "pending").toLowerCase();
    if (status === "pending") conditions.push("a.handled = 0");
    else if (status === "handled") conditions.push("a.handled = 1");

    const search = String(body?.Search || "").trim().toLowerCase();
    if (search) {
      conditions.push("(u.user_lower LIKE ? OR LOWER(a.appeal) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = countRows(`
      SELECT COUNT(*) AS c FROM ban_appeals a LEFT JOIN users u ON u.id = a.user_id ${where}
    `, ...params);
    const rows = db.prepare(`
      SELECT a.*, u.user, u.role, u.status AS user_status, u.ban_data
      FROM ban_appeals a LEFT JOIN users u ON u.id = a.user_id
      ${where}
      ORDER BY a.timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return {
      Code: 200,
      Appeals: rows.map(row => ({
        _id: row.id,
        UserID: row.user_id,
        User: row.user || "Unknown",
        Role: row.role || null,
        UserStatus: row.user_status || null,
        BanData: parseJson(row.ban_data),
        Appeal: row.appeal,
        Timestamp: row.timestamp,
        Handled: row.handled === 1,
        AdminNote: row.admin_note || null,
        ReviewedBy: row.reviewed_by || null,
        ReviewedAt: row.reviewed_at || null
      })),
      Total: total,
      Page: page,
      Pages: pagesFor(total, limit),
      Limit: limit
    };
  }

  if (task === "Resolve") {
    const appealId = body?.AppealID;
    const action = String(body?.Action || "Dismiss");
    const appeal = db.prepare("SELECT * FROM ban_appeals WHERE id = ?").get(appealId) as any;
    if (!appeal) return { Code: 404, Message: "Appeal not found." };

    if (action === "Unban") {
      const ownerDenied = guardOwner(currentUser);
      if (ownerDenied) return ownerDenied;
      db.prepare("UPDATE users SET status = 'active', ban_data = NULL WHERE id = ?").run(appeal.user_id);
    }

    if (action === "Reopen") {
      db.prepare(`
        UPDATE ban_appeals SET handled = 0, admin_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?
      `).run(body?.Note == null ? null : String(body.Note).slice(0, 500), currentUser.id, Date.now(), appealId);
      logAdminAction(currentUser, "AppealReopened", appeal.user_id, { AppealID: appealId });
      return { Code: 200, AppealID: appealId, Handled: false };
    }

    if (action !== "Unban" && action !== "Dismiss") {
      return { Code: 400, Message: "Unknown appeal action." };
    }

    db.prepare(`
      UPDATE ban_appeals SET handled = 1, admin_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?
    `).run(body?.Note == null ? null : String(body.Note).slice(0, 500), currentUser.id, Date.now(), appealId);
    logAdminAction(currentUser, action === "Unban" ? "AppealUnbanned" : "AppealDismissed", appeal.user_id, {
      AppealID: appealId
    });
    return { Code: 200, AppealID: appealId, Handled: true, Action: action };
  }

  return { Code: 400, Message: "Unknown appeals task." };
}

export function handleAdminBroadcast(body: any, currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;
  if (!currentUser) return { Code: 401 };

  const mode = String(body?.Mode || "");
  if (!["Reload", "Feed", "Announcement"].includes(mode)) {
    return { Code: 400, Message: "Invalid broadcast mode." };
  }
  const message = String(body?.Message || "").slice(0, 500);
  const level = ["info", "success", "warning", "alert"].includes(String(body?.Level)) ? String(body.Level) : "info";

  logAdminAction(currentUser, "Broadcast", null, { Mode: mode, Message: message, Level: level });

  return {
    Code: 200,
    Broadcast: {
      Mode: mode,
      Message: message,
      Level: level
    }
  };
}

export function handleAdminSessions(body: any, currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;
  if (!currentUser) return { Code: 401 };

  const task = String(body?.Task || "List");

  if (task === "List") {
    const { page, limit, offset } = pagination(body);
    const conditions: string[] = [];
    const params: any[] = [];
    const status = String(body?.Status || "Active");
    if (status === "Active") conditions.push("s.expires_at > strftime('%s','now')");
    else if (status === "Expired") conditions.push("s.expires_at <= strftime('%s','now')");

    const search = String(body?.Search || "").trim().toLowerCase();
    if (search) {
      conditions.push("(u.user_lower LIKE ? OR s.ip LIKE ? OR s.user_id = ?)");
      params.push(`%${search}%`, `%${search}%`, search);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = countRows(`
      SELECT COUNT(*) AS c FROM sessions s LEFT JOIN users u ON u.id = s.user_id ${where}
    `, ...params);
    const rows = db.prepare(`
      SELECT s.user_id, s.ip, MIN(s.last_visit) AS first_seen, MAX(s.last_visit) AS last_seen,
             MAX(s.expires_at) AS expires_at, COUNT(*) AS count,
             u.user, u.role, u.status
      FROM sessions s LEFT JOIN users u ON u.id = s.user_id
      ${where}
      GROUP BY s.user_id, s.ip
      ORDER BY last_seen DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return {
      Code: 200,
      Sessions: rows.map(row => ({
        Key: `${row.user_id}|${row.ip}`,
        UserID: row.user_id,
        User: row.user || "Unknown",
        Role: row.role || null,
        UserStatus: row.status || null,
        IP: row.ip,
        FirstSeen: row.first_seen,
        LastSeen: row.last_seen,
        ExpiresAt: row.expires_at,
        Count: Number(row.count || 0)
      })),
      Total: total,
      Page: page,
      Pages: pagesFor(total, limit),
      Limit: limit
    };
  }

  if (task === "Revoke") {
    const userId = body?.UserID;
    if (!userId) return { Code: 400, Message: "Missing UserID." };
    const target = db.prepare("SELECT id, user, role FROM users WHERE id = ?").get(userId) as any;
    if (!target) return { Code: 404, Message: "User not found." };
    if (parseRoles(target.role).includes("Owner") && !isOwner(currentUser)) {
      return { Code: 403, Message: "Only an Owner can sign out another Owner." };
    }

    const ip = body?.IP ? String(body.IP) : null;
    if (ip) {
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND ip = ?").run(userId, ip);
    } else {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    }
    logAdminAction(currentUser, "SessionRevoked", target.user, { IP: ip });
    return { Code: 200, RevokeSessionsFor: userId, RevokeIP: ip };
  }

  if (task === "Cleanup") {
    const before = countRows("SELECT COUNT(*) AS c FROM sessions WHERE expires_at <= strftime('%s','now')");
    db.prepare("DELETE FROM sessions WHERE expires_at <= strftime('%s','now')").run();
    logAdminAction(currentUser, "SessionsCleaned", null, { Removed: before });
    return { Code: 200, Removed: before };
  }

  return { Code: 400, Message: "Unknown sessions task." };
}

export function handleAdminLog(currentUser: UserRecord | null): any {
  const denied = guardStaff(currentUser);
  if (denied) return denied;

  const rows = db.prepare(`
    SELECT l.*, u.user AS actor_name, u.role AS actor_role
    FROM admin_log l LEFT JOIN users u ON u.id = l.actor_id
    ORDER BY l.timestamp DESC LIMIT 100
  `).all() as any[];

  return {
    Code: 200,
    Log: rows.map(row => ({
      _id: row.id,
      ActorID: row.actor_id,
      Actor: row.actor_name || "Unknown",
      ActorRole: row.actor_role || null,
      Action: row.action,
      Target: row.target || null,
      Details: parseJson(row.details),
      Timestamp: row.timestamp
    }))
  };
}
