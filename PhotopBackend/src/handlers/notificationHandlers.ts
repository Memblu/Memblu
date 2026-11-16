import { db } from "../db.js";
import { UserRecord } from "../types.js";
import {
  getNotificationPreferences,
  getNotifications,
  getPushSubscriptions,
  getUnreadCount,
  getVapidPublicKey,
  markAllNotificationsRead,
  markInstallPromptSeen,
  markNotificationsRead,
  removePushSubscription,
  saveNotificationPreferences,
  savePushSubscription
} from "../notifications.js";

export function handleGetNotifications(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };

  const page = getNotifications(currentUser.id, {
    before: body?.Before,
    amount: body?.Amount
  });

  return {
    Code: 200,
    Notifications: page.Notifications,
    Users: page.Users,
    Unread: page.Unread,
    LastCreatedAt: page.LastCreatedAt
  };
}

export function handleGetNotificationCount(currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  return { Code: 200, Unread: getUnreadCount(currentUser.id) };
}

export function handleMarkNotificationsRead(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  const ids = body?.NotificationIDs || (body?.NotificationID ? [body.NotificationID] : []);
  const unread = markNotificationsRead(currentUser.id, ids);
  return { Code: 200, Unread: unread };
}

export function handleMarkAllNotificationsRead(currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  const unread = markAllNotificationsRead(currentUser.id);
  return { Code: 200, Unread: unread };
}

export function handleGetNotificationSettings(currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  return {
    Code: 200,
    Settings: getNotificationPreferences(currentUser),
    PushSubscribed: getPushSubscriptions(currentUser.id).length > 0,
    VapidPublicKey: getVapidPublicKey()
  };
}

export function handleUpdateNotificationSettings(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  const settings = saveNotificationPreferences(currentUser.id, body?.Settings || body || {});
  return { Code: 200, Settings: settings };
}

export function handleMarkInstallPromptSeen(currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  markInstallPromptSeen(currentUser.id);
  return { Code: 200, InstallPromptSeen: true };
}

export function handleSubscribePush(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  const subscription = body?.Subscription || body;
  const saved = savePushSubscription(currentUser.id, subscription, body?.UserAgent || null);
  if (!saved) {
    return { Code: 400, Message: "Invalid push subscription." };
  }
  return { Code: 200, Subscribed: true, DeviceCount: getPushSubscriptions(currentUser.id).length };
}

export function handleUnsubscribePush(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  const endpoint = typeof body?.Endpoint === "string" && body.Endpoint ? body.Endpoint : null;
  const removed = removePushSubscription(currentUser.id, endpoint === "All" ? null : endpoint);
  return {
    Code: 200,
    Subscribed: getPushSubscriptions(currentUser.id).length > 0,
    Removed: removed,
    DeviceCount: getPushSubscriptions(currentUser.id).length
  };
}

export function handleGetPushStatus(currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401, Message: "Not authenticated." };
  const count = getPushSubscriptions(currentUser.id).length;
  return {
    Code: 200,
    Subscribed: count > 0,
    DeviceCount: count,
    VapidPublicKey: getVapidPublicKey()
  };
}

// A small admin/debug counter is useful when checking that cleanup ran.
export function handleNotificationStats(currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401 };
  const row = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient_id = ?").get(currentUser.id) as { c?: number } | undefined;
  return {
    Code: 200,
    Total: Number(row?.c || 0),
    Unread: getUnreadCount(currentUser.id),
    PushDevices: getPushSubscriptions(currentUser.id).length
  };
}
