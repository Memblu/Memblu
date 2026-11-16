import * as webpush from "web-push";
import { db } from "./db.js";
import { generateId } from "./auth.js";
import {
  NotificationPreferences,
  NotificationRecord,
  NotificationType,
  PushSubscriptionRecord,
  UserRecord
} from "./types.js";

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  Likes: true,
  Quotes: true,
  Chats: true,
  Replies: true,
  Mentions: true,
  Follows: true,
  FollowedPosts: true,
  ThreadActivity: true,
  InstallPromptSeen: false
};

// Types that can be folded into an existing row instead of creating one more.
const GROUPABLE_TYPES: NotificationType[] = [
  "LikePost",
  "LikeChat",
  "QuotePost",
  "QuoteChat",
  "ThreadActivity",
  "NewPost"
];

// Deduplicated per event: a repeated delivery for the same event is dropped.
const DEDUPE_TYPES: NotificationType[] = ["MentionPost", "MentionChat", "Follow", "ModeratePost", "ModerateChat"];

const CATEGORY_BY_TYPE: Record<NotificationType, keyof NotificationPreferences | null> = {
  LikePost: "Likes",
  LikeChat: "Likes",
  QuotePost: "Quotes",
  QuoteChat: "Quotes",
  ChatPost: "Chats",
  ReplyChat: "Replies",
  MentionPost: "Mentions",
  MentionChat: "Mentions",
  Follow: "Follows",
  NewPost: "FollowedPosts",
  ThreadActivity: "ThreadActivity",
  // Moderation is mandatory and cannot be switched off.
  ModeratePost: null,
  ModerateChat: null
};

type Broadcaster = (userId: string, notification: any, unread: number) => void;
type ActiveUserChecker = (userId: string) => boolean;

let broadcastNotification: Broadcaster = () => {};
let activeUserChecker: ActiveUserChecker = () => false;
let pushReady = false;
let vapidPublicKey = "";

export function setNotificationBroadcaster(fn: Broadcaster): void {
  broadcastNotification = fn;
}

// The WebSocket gateway reports which accounts currently have an open socket so
// push notifications are not sent to someone already looking at the app.
export function setActiveUserChecker(fn: ActiveUserChecker): void {
  activeUserChecker = fn;
}

export function getVapidPublicKey(): string {
  return vapidPublicKey;
}

export function configurePush(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@memblu.local";
  vapidPublicKey = publicKey;

  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set; Web Push is disabled.");
    return false;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    pushReady = true;
    return true;
  } catch (err: any) {
    console.error("[push] Invalid VAPID configuration:", err.message);
    pushReady = false;
    return false;
  }
}

function parseJson(value: string | null | undefined, fallback: any): any {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getUser(userId: string): UserRecord | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRecord | undefined;
}

function isBlocked(recipient: UserRecord, actorId: string | null | undefined): boolean {
  if (!actorId) return false;
  const blocked = parseJson(recipient.blocked_users, []);
  return Array.isArray(blocked) && blocked.includes(actorId);
}

export function getNotificationPreferences(user: UserRecord | null): NotificationPreferences {
  if (!user) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  const settings = parseJson(user.settings, {});
  const stored = settings && typeof settings.Notifications === "object" ? settings.Notifications : {};
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES } as any;
  for (const key of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES)) {
    if (typeof stored[key] === "boolean") prefs[key] = stored[key];
  }
  return prefs as NotificationPreferences;
}

export function saveNotificationPreferences(userId: string, patch: any): NotificationPreferences {
  const user = getUser(userId);
  if (!user) return { ...DEFAULT_NOTIFICATION_PREFERENCES };

  const settings = parseJson(user.settings, {});
  const current = getNotificationPreferences(user);
  const next: any = { ...current };
  if (patch && typeof patch === "object") {
    for (const key of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES)) {
      if (typeof patch[key] === "boolean") next[key] = patch[key];
    }
  }
  // Moderation cannot be disabled, so it is not part of the preferences.
  settings.Notifications = next;
  db.prepare("UPDATE users SET settings = ? WHERE id = ?").run(JSON.stringify(settings), userId);
  return next;
}

export function markInstallPromptSeen(userId: string): void {
  const user = getUser(userId);
  if (!user) return;
  const settings = parseJson(user.settings, {});
  const notif = { ...getNotificationPreferences(user), InstallPromptSeen: true };
  settings.Notifications = notif;
  db.prepare("UPDATE users SET settings = ? WHERE id = ?").run(JSON.stringify(settings), userId);
}

function isTypeEnabled(recipient: UserRecord, type: NotificationType): boolean {
  const category = CATEGORY_BY_TYPE[type];
  if (category == null) return true; // Moderation always delivers.
  return getNotificationPreferences(recipient)[category];
}

export function extractMentionedUserIds(text: string): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  const regex = /@([A-Za-z0-9_-]{3,16})(?:<([A-Fa-f0-9]{24})>)?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const id = match[2];
    if (id) {
      const found = db.prepare("SELECT id FROM users WHERE id = ?").get(id) as { id: string } | undefined;
      if (found) ids.add(found.id);
      continue;
    }
    const found = db.prepare("SELECT id FROM users WHERE user_lower = ?").get(match[1].toLowerCase()) as { id: string } | undefined;
    if (found) ids.add(found.id);
  }
  return Array.from(ids);
}

export function extractReferenceIds(text: string, prefix: "Post" | "Chat"): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  const regex = new RegExp(`/${prefix}_([A-Fa-f0-9]{24})`, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

export function getThreadParticipantIds(postId: string): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT user_id FROM likes WHERE post_id = ?
    UNION
    SELECT DISTINCT user_id FROM chats WHERE post_id = ? AND hidden = 0
  `).all(postId, postId) as Array<{ user_id: string }>;
  return rows.map(row => row.user_id).filter(Boolean);
}

export function getFollowerIds(userId: string): string[] {
  const rows = db.prepare("SELECT follower_id FROM follows WHERE target_id = ?").all(userId) as Array<{ follower_id: string }>;
  return rows.map(row => row.follower_id).filter(Boolean);
}

function formatNotification(row: NotificationRecord, userMap: Record<string, any>): any {
  const actors = parseJson(row.actors, []);
  const actor = row.actor_id ? userMap[row.actor_id] || null : null;
  return {
    _id: row.id,
    Type: row.type,
    ActorID: row.actor_id || null,
    Actor: actor,
    Actors: Array.isArray(actors) ? actors : [],
    PostID: row.post_id || null,
    ChatID: row.chat_id || null,
    Preview: getChatPreview(row.chat_id),
    Count: row.count || 1,
    Action: row.action || null,
    Reason: row.reason || null,
    CreatedAt: row.created_at,
    UpdatedAt: row.updated_at,
    Read: row.read === 1
  };
}

function loadUsers(ids: string[]): Record<string, any> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const users: Record<string, any> = {};
  if (unique.length === 0) return users;

  const placeholders = unique.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, user, role, settings FROM users WHERE id IN (${placeholders})`).all(...unique) as any[];
  for (const row of rows) {
    users[row.id] = {
      _id: row.id,
      User: row.user,
      Role: row.role,
      Settings: parseJson(row.settings, {})
    };
  }
  return users;
}

export function getUnreadCount(userId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient_id = ? AND read = 0").get(userId) as { c?: number } | undefined;
  return Number(row?.c || 0);
}

interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  actorId?: string | null;
  postId?: string | null;
  chatId?: string | null;
  groupKey: string;
  action?: string | null;
  reason?: string | null;
}

// Creates (or folds another actor into) one notification. Returns the stored
// row so callers can react to it, or null when nothing should be delivered.
export function createNotification(input: CreateNotificationInput): NotificationRecord | null {
  const { recipientId, type, actorId = null, postId = null, chatId = null, groupKey, action = null, reason = null } = input;
  if (!recipientId || !groupKey) return null;
  if (actorId && actorId === recipientId) return null; // Never notify your own actions.

  const recipient = getUser(recipientId);
  if (!recipient || recipient.status !== "active") return null;
  if (isBlocked(recipient, actorId)) return null;
  if (!isTypeEnabled(recipient, type)) return null;

  const now = Date.now();
  const existing = db.prepare(
    "SELECT * FROM notifications WHERE recipient_id = ? AND type = ? AND group_key = ?"
  ).get(recipientId, type, groupKey) as NotificationRecord | undefined;

  let row: NotificationRecord;

  if (existing) {
    if (DEDUPE_TYPES.includes(type)) {
      // Same event: keep the original entry, but update moderation details so
      // the newest reason/action is shown.
      if (type === "ModeratePost" || type === "ModerateChat") {
        db.prepare("UPDATE notifications SET action = ?, reason = ?, updated_at = ?, read = 0 WHERE id = ?")
          .run(action, reason, now, existing.id);
        row = db.prepare("SELECT * FROM notifications WHERE id = ?").get(existing.id) as unknown as NotificationRecord;
      } else {
        return null;
      }
    } else if (GROUPABLE_TYPES.includes(type)) {
      const actors = parseJson(existing.actors, []);
      const actorList: string[] = Array.isArray(actors) ? actors.filter(Boolean) : [];
      if (actorId && !actorList.includes(actorId)) {
        actorList.push(actorId);
        if (actorList.length > 12) actorList.shift();
      }
      const count = (existing.count || 1) + 1;
      db.prepare(`
        UPDATE notifications
        SET actor_id = ?, post_id = COALESCE(?, post_id), chat_id = COALESCE(?, chat_id),
            count = ?, actors = ?, updated_at = ?, read = 0
        WHERE id = ?
      `).run(actorId, postId, chatId, count, JSON.stringify(actorList), now, existing.id);
      row = db.prepare("SELECT * FROM notifications WHERE id = ?").get(existing.id) as unknown as NotificationRecord;
    } else {
      return null;
    }
  } else {
    const id = generateId();
    const actors = actorId ? JSON.stringify([actorId]) : JSON.stringify([]);
    db.prepare(`
      INSERT INTO notifications
        (id, recipient_id, type, actor_id, post_id, chat_id, group_key, count, actors, action, reason, created_at, updated_at, read)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0)
    `).run(id, recipientId, type, actorId, postId, chatId, groupKey, actors, action, reason, now, now);
    row = db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as unknown as NotificationRecord;
  }

  const users = loadUsers([row.actor_id || "", ...parseJson(row.actors, [])]);
  const formatted = formatNotification(row, users);
  const unread = getUnreadCount(recipientId);
  broadcastNotification(recipientId, formatted, unread);
  void sendPushForNotification(row, recipientId);
  return row;
}

// Un-liking a post or chat must remove that actor from the grouped entry and
// drop the notification entirely once nobody is left.
export function removeNotificationActor(recipientId: string, type: NotificationType, groupKey: string, actorId: string): void {
  const row = db.prepare(
    "SELECT * FROM notifications WHERE recipient_id = ? AND type = ? AND group_key = ?"
  ).get(recipientId, type, groupKey) as NotificationRecord | undefined;
  if (!row) return;

  const actors = (parseJson(row.actors, []) as string[]).filter(id => id && id !== actorId);
  const count = Math.max(0, (row.count || 1) - 1);

  if (count <= 0) {
    db.prepare("DELETE FROM notifications WHERE id = ?").run(row.id);
    broadcastNotification(recipientId, { _id: row.id, Removed: true }, getUnreadCount(recipientId));
    return;
  }

  const nextActor = actors.length > 0 ? actors[actors.length - 1] : null;
  db.prepare("UPDATE notifications SET count = ?, actors = ?, actor_id = ?, updated_at = ? WHERE id = ?")
    .run(count, JSON.stringify(actors), nextActor, Date.now(), row.id);
  const updated = db.prepare("SELECT * FROM notifications WHERE id = ?").get(row.id) as unknown as NotificationRecord;
  const users = loadUsers([updated.actor_id || "", ...actors]);
  broadcastNotification(recipientId, formatNotification(updated, users), getUnreadCount(recipientId));
}

export function getNotifications(
  userId: string,
  options: { before?: number | null; amount?: number } = {}
): { Notifications: any[]; Users: Record<string, any>; Unread: number; LastCreatedAt: number } {
  const amount = Math.min(Math.max(Number(options.amount) || 20, 1), 50);
  const conditions = ["recipient_id = ?"];
  const params: any[] = [userId];
  if (options.before != null && Number.isFinite(Number(options.before))) {
    conditions.push("created_at < ?");
    params.push(Number(options.before));
  }

  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params, amount) as unknown as NotificationRecord[];

  const actorIds: string[] = [];
  for (const row of rows) {
    if (row.actor_id) actorIds.push(row.actor_id);
    for (const id of parseJson(row.actors, [])) actorIds.push(id);
  }
  const users = loadUsers(actorIds);
  const last = rows.length > 0 ? rows[rows.length - 1].created_at : 0;

  return {
    Notifications: rows.map(row => formatNotification(row, users)),
    Users: users,
    Unread: getUnreadCount(userId),
    LastCreatedAt: last
  };
}

export function markNotificationsRead(userId: string, ids: string[]): number {
  const valid = Array.isArray(ids) ? ids.filter(id => typeof id === "string" && id) : [];
  if (valid.length > 0) {
    const placeholders = valid.map(() => "?").join(",");
    db.prepare(`UPDATE notifications SET read = 1 WHERE recipient_id = ? AND id IN (${placeholders})`)
      .run(userId, ...valid);
  }
  return getUnreadCount(userId);
}

export function markAllNotificationsRead(userId: string): number {
  db.prepare("UPDATE notifications SET read = 1 WHERE recipient_id = ? AND read = 0").run(userId);
  return 0;
}

interface ContentModeratedInput {
  targetType: "Post" | "Chat";
  targetId: string;
  actorId?: string | null;
  action?: string;
  reason?: string | null;
}

// Moderation notices always deliver, even if every optional category is off.
export function notifyContentModerated(input: ContentModeratedInput): void {
  const { targetType, targetId, actorId = null, action = "Removed", reason = null } = input;
  let ownerId: string | null = null;
  let postId: string | null = null;
  let chatId: string | null = null;

  if (targetType === "Post") {
    const post = db.prepare("SELECT id, user_id FROM posts WHERE id = ?").get(targetId) as { id: string; user_id: string } | undefined;
    if (!post) return;
    ownerId = post.user_id;
    postId = post.id;
  } else {
    const chat = db.prepare("SELECT id, post_id, user_id FROM chats WHERE id = ?").get(targetId) as { id: string; post_id: string; user_id: string } | undefined;
    if (!chat) return;
    ownerId = chat.user_id;
    postId = chat.post_id;
    chatId = chat.id;
  }

  createNotification({
    recipientId: ownerId,
    type: targetType === "Post" ? "ModeratePost" : "ModerateChat",
    actorId,
    postId,
    chatId,
    groupKey: `moderate:${targetType}:${targetId}`,
    action,
    reason
  });
}

function getChatPreview(chatId: string | null | undefined): string | null {
  if (!chatId) return null;
  const row = db.prepare("SELECT text FROM chats WHERE id = ?").get(chatId) as { text: string } | undefined;
  if (!row || !row.text) return null;
  const text = String(row.text).trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function getActorName(actorId: string | null | undefined): string {
  if (!actorId) return "Someone";
  const row = db.prepare("SELECT user FROM users WHERE id = ?").get(actorId) as { user: string } | undefined;
  return row ? row.user : actorId ? actorId : "Someone";
}

function countLabel(count: number): string {
  return count > 1 ? `${count} people` : count === 1 ? "1 person" : "Someone";
}

function notificationText(row: NotificationRecord): { title: string; body: string; url: string } {
  const actor = getActorName(row.actor_id);
  const count = row.count || 1;
  const preview = getChatPreview(row.chat_id);
  let title = "Memblu";
  let body = "You have a new notification.";
  const base = process.env.PUBLIC_DOMAIN
    ? `${process.env.VIRTUAL_PROTOCOL || process.env.PUBLIC_PROTOCOL || "https"}://${process.env.PUBLIC_DOMAIN}`
    : "";

  switch (row.type) {
    case "LikePost":
      title = "New like";
      body = count > 1 ? `${countLabel(count)} liked your post` : `${actor} liked your post`;
      break;
    case "QuotePost":
      title = "New quote";
      body = count > 1 ? `${countLabel(count)} quoted your post` : `${actor} quoted your post`;
      break;
    case "ChatPost":
      title = actor;
      body = preview ? preview : `${actor} chatted on your post`;
      break;
    case "ModeratePost":
      title = "Post moderated";
      body = row.reason ? `Your post was ${row.action || "removed"}: ${row.reason}` : `Your post was ${String(row.action || "Removed").toLowerCase()}.`;
      break;
    case "LikeChat":
      title = "New like";
      body = count > 1 ? `${countLabel(count)} liked your chat` : `${actor} liked your chat`;
      break;
    case "ReplyChat":
      title = actor;
      body = preview ? `Replied to you: "${preview}"` : `Replied to you: ${actor}`;
      break;
    case "QuoteChat":
      title = actor;
      body = preview ? preview : `${actor} quoted your chat`;
      break;
    case "ModerateChat":
      title = "Chat moderated";
      body = row.reason ? `Your chat was ${row.action || "removed"}: ${row.reason}` : `Your chat was ${String(row.action || "Removed").toLowerCase()}.`;
      break;
    case "MentionPost":
      title = "You were mentioned";
      body = `${actor} mentioned you in a post`;
      break;
    case "MentionChat":
      title = actor;
      body = preview ? preview : `${actor} mentioned you in a chat`;
      break;
    case "NewPost":
      title = "New post";
      body = count > 1 ? `${actor} posted ${count} new posts` : `${actor} posted something new`;
      break;
    case "Follow":
      title = "New follower";
      body = `${actor} followed you`;
      break;
    case "ThreadActivity":
      title = actor;
      body = preview ? preview : `${actor} chatted on a post you're involved in`;
      break;
  }

  let url = base + "/";
  if (row.post_id) {
    url = `${base}/?post=${encodeURIComponent(row.post_id)}`;
    if (row.chat_id) url += `&chat=${encodeURIComponent(row.chat_id)}`;
  }
  return { title, body, url };
}

export function getPushSubscriptions(userId: string): PushSubscriptionRecord[] {
  return db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC").all(userId) as unknown as PushSubscriptionRecord[];
}

export function savePushSubscription(userId: string, subscription: any, userAgent?: string | null): boolean {
  const endpoint = subscription && subscription.endpoint;
  const keys = subscription && subscription.keys;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) return false;

  const existing = db.prepare("SELECT id FROM push_subscriptions WHERE endpoint = ?").get(endpoint) as { id: string } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ? WHERE id = ?
    `).run(userId, keys.p256dh, keys.auth, userAgent || null, existing.id);
    return true;
  }

  db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(generateId(), userId, endpoint, keys.p256dh, keys.auth, userAgent || null, Date.now());
  return true;
}

export function removePushSubscription(userId: string, endpoint: string | null): number {
  if (endpoint) {
    return Number(db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(userId, endpoint).changes || 0);
  }
  return Number(db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(userId).changes || 0);
}

function removeSubscriptionById(id: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(id);
}

async function sendPushForNotification(row: NotificationRecord, recipientId: string): Promise<void> {
  if (!pushReady) return;
  // Someone actively using the app already got the realtime packet.
  if (activeUserChecker(recipientId)) return;

  const subscriptions = getPushSubscriptions(recipientId);
  if (subscriptions.length === 0) return;

  const text = notificationText(row);
  const payload = JSON.stringify({
    title: text.title,
    body: text.body,
    icon: "/Images/SquarePhotopIcon.png",
    badge: "/Images/SquarePhotopIcon.png",
    url: text.url,
    tag: `${row.type}:${row.group_key}`
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        },
        payload,
        { TTL: 60 * 60 * 24 }
      );
    } catch (err: any) {
      const status = err && err.statusCode;
      if (status === 404 || status === 410) {
        removeSubscriptionById(sub.id);
      } else {
        console.error("[push] Failed to deliver notification:", err && err.message ? err.message : err);
      }
    }
  }
}

// ── High level event hooks ──────────────────────────────────────────────────

interface RecipientPlan {
  recipientId: string;
  type: NotificationType;
  groupKey: string;
  postId: string | null;
  chatId: string | null;
}

function addPlan(plans: Map<string, RecipientPlan>, plan: RecipientPlan, actorId: string): void {
  if (!plan.recipientId || plan.recipientId === actorId) return;
  if (!plans.has(plan.recipientId)) plans.set(plan.recipientId, plan);
}

function deliverPlans(plans: Map<string, RecipientPlan>, actorId: string): void {
  for (const plan of plans.values()) {
    createNotification({
      recipientId: plan.recipientId,
      type: plan.type,
      actorId,
      postId: plan.postId,
      chatId: plan.chatId,
      groupKey: plan.groupKey
    });
  }
}

export function notifyPostCreated(input: { actorId: string; postId: string; text: string }): void {
  const { actorId, postId, text } = input;
  const plans = new Map<string, RecipientPlan>();

  // Mentions are the most specific notification for a recipient.
  for (const recipientId of extractMentionedUserIds(text)) {
    addPlan(plans, {
      recipientId,
      type: "MentionPost",
      groupKey: `post:${postId}:mention`,
      postId,
      chatId: null
    }, actorId);
  }

  // Quoted posts, then quoted chats.
  for (const quotedPostId of extractReferenceIds(text, "Post")) {
    const post = db.prepare("SELECT user_id FROM posts WHERE id = ? AND deleted = 0").get(quotedPostId) as { user_id: string } | undefined;
    if (post) {
      addPlan(plans, {
        recipientId: post.user_id,
        type: "QuotePost",
        groupKey: `post:${quotedPostId}:quote`,
        postId: quotedPostId,
        chatId: null
      }, actorId);
    }
  }

  for (const quotedChatId of extractReferenceIds(text, "Chat")) {
    const chat = db.prepare("SELECT user_id, post_id FROM chats WHERE id = ? AND hidden = 0").get(quotedChatId) as { user_id: string; post_id: string } | undefined;
    if (chat) {
      addPlan(plans, {
        recipientId: chat.user_id,
        type: "QuoteChat",
        groupKey: `chat:${quotedChatId}:quote`,
        postId: chat.post_id,
        chatId: quotedChatId
      }, actorId);
    }
  }

  // Followers see new posts, unless a more specific notification already covers
  // this post for them (mention or quote).
  for (const followerId of getFollowerIds(actorId)) {
    addPlan(plans, {
      recipientId: followerId,
      type: "NewPost",
      groupKey: `followed:${actorId}`,
      postId,
      chatId: null
    }, actorId);
  }

  deliverPlans(plans, actorId);
}

export function notifyPostLiked(input: { actorId: string; postId: string }): void {
  const post = db.prepare("SELECT user_id FROM posts WHERE id = ? AND deleted = 0").get(input.postId) as { user_id: string } | undefined;
  if (!post) return;
  createNotification({
    recipientId: post.user_id,
    type: "LikePost",
    actorId: input.actorId,
    postId: input.postId,
    groupKey: `post:${input.postId}:like`
  });
}

export function notifyPostUnliked(input: { actorId: string; postId: string }): void {
  const post = db.prepare("SELECT user_id FROM posts WHERE id = ?").get(input.postId) as { user_id: string } | undefined;
  if (!post) return;
  removeNotificationActor(post.user_id, "LikePost", `post:${input.postId}:like`, input.actorId);
}

export function notifyChatLiked(input: { actorId: string; chatId: string }): void {
  const chat = db.prepare("SELECT user_id, post_id FROM chats WHERE id = ? AND hidden = 0").get(input.chatId) as { user_id: string; post_id: string } | undefined;
  if (!chat) return;
  createNotification({
    recipientId: chat.user_id,
    type: "LikeChat",
    actorId: input.actorId,
    postId: chat.post_id,
    chatId: input.chatId,
    groupKey: `chat:${input.chatId}:like`
  });
}

export function notifyChatUnliked(input: { actorId: string; chatId: string }): void {
  const chat = db.prepare("SELECT user_id FROM chats WHERE id = ?").get(input.chatId) as { user_id: string } | undefined;
  if (!chat) return;
  removeNotificationActor(chat.user_id, "LikeChat", `chat:${input.chatId}:like`, input.actorId);
}

export function notifyChatCreated(input: {
  actorId: string;
  chatId: string;
  postId: string;
  text: string;
  replyId?: string | null;
}): void {
  const { actorId, chatId, postId, text, replyId } = input;
  const plans = new Map<string, RecipientPlan>();
  const post = db.prepare("SELECT user_id FROM posts WHERE id = ?").get(postId) as { user_id: string } | undefined;
  const postAuthorId = post ? post.user_id : null;

  // Mentions first: a mention inside a chat on my own post is one mention
  // notification, not also a "chatted on your post" one.
  for (const recipientId of extractMentionedUserIds(text)) {
    addPlan(plans, {
      recipientId,
      type: "MentionChat",
      groupKey: `chat:${chatId}:mention`,
      postId,
      chatId
    }, actorId);
  }

  // Quoted chats from inside a chat.
  for (const quotedChatId of extractReferenceIds(text, "Chat")) {
    const chat = db.prepare("SELECT user_id, post_id FROM chats WHERE id = ? AND hidden = 0").get(quotedChatId) as { user_id: string; post_id: string } | undefined;
    if (chat) {
      addPlan(plans, {
        recipientId: chat.user_id,
        type: "QuoteChat",
        groupKey: `chat:${quotedChatId}:quote`,
        postId: chat.post_id,
        chatId: quotedChatId
      }, actorId);
    }
  }

  if (replyId) {
    const replyChat = db.prepare("SELECT user_id FROM chats WHERE id = ? AND hidden = 0").get(replyId) as { user_id: string } | undefined;
    if (replyChat) {
      addPlan(plans, {
        recipientId: replyChat.user_id,
        type: "ReplyChat",
        groupKey: `chat:${replyId}:reply`,
        postId,
        chatId
      }, actorId);
    }
  }

  if (postAuthorId) {
    addPlan(plans, {
      recipientId: postAuthorId,
      type: "ChatPost",
      groupKey: `post:${postId}:chat:${chatId}`,
      postId,
      chatId
    }, actorId);
  }

  // People who liked or chatted on the post earlier get thread activity, unless
  // a more specific notification already applies.
  for (const participantId of getThreadParticipantIds(postId)) {
    addPlan(plans, {
      recipientId: participantId,
      type: "ThreadActivity",
      groupKey: `post:${postId}:thread`,
      postId,
      chatId: null
    }, actorId);
  }

  deliverPlans(plans, actorId);
}

export function notifyNewFollower(input: { actorId: string; targetId: string }): void {
  createNotification({
    recipientId: input.targetId,
    type: "Follow",
    actorId: input.actorId,
    groupKey: `follow:${input.actorId}`
  });
}

export function cleanupNotifications(): void {
  const now = Date.now();
  db.prepare("DELETE FROM notifications WHERE read = 1 AND created_at < ?").run(now - 30 * DAY);
  db.prepare("DELETE FROM notifications WHERE created_at < ?").run(now - 90 * DAY);
}

export function startNotificationMaintenance(): void {
  cleanupNotifications();
  const timer = setInterval(cleanupNotifications, DAY);
  timer.unref();
}
