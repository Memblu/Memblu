import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "node:http";
import { validateSession } from "./auth.js";
import { ClientRequestPacket, UserRecord } from "./types.js";
import {
  handleCreateConnection,
  handleSignUpAccount,
  handleSignInAccount,
  handleGetAccountData,
  handleLogoutAccount,
  handleUsernameAvailability
} from "./handlers/authHandlers.js";
import {
  handleGetPosts,
  handleCreatePost,
  handleUpdatePost,
  handleLikePost,
  handleUnlikePost
} from "./handlers/postHandlers.js";
import {
  handleConnectLiveChat,
  handleGetChats,
  handleCreateChat,
  handleUpdateChat,
  handleLikeChat,
  handleUnlikeChat,
  handleGetLiveCount
} from "./handlers/chatHandlers.js";
import {
  handleGetProfile,
  handleGetUserInfo,
  handleFollowUser,
  handleUnfollowUser,
  handleGetFollowData,
  handleGetProfileLikes,
  handleGetProfileChats,
  handleSearch
} from "./handlers/profileHandlers.js";
import {
  handleUpdateAccountData,
  handleGetActiveDevices,
  handleSignOutSession,
  handleManageAccount,
  handleAddBlockedUser,
  handleGetBlockedUsers,
  handleUnblockUsers
} from "./handlers/settingsHandlers.js";
import {
  handleModerateUserAction,
  handleSendBanAppeal,
  handleUnbanUser,
  handlePostWebhook
} from "./handlers/moderationHandlers.js";
import { handleLoadPlatformEmbeds } from "./handlers/embedHandlers.js";
import {
  handleGetNotifications,
  handleGetNotificationCount,
  handleMarkNotificationsRead,
  handleMarkAllNotificationsRead,
  handleGetNotificationSettings,
  handleUpdateNotificationSettings,
  handleMarkInstallPromptSeen,
  handleSubscribePush,
  handleUnsubscribePush,
  handleGetPushStatus,
  handleNotificationStats
} from "./handlers/notificationHandlers.js";
import {
  configurePush,
  setActiveUserChecker,
  setNotificationBroadcaster,
  startNotificationMaintenance
} from "./notifications.js";
import {
  handleAdminOverview,
  handleAdminGetUsers,
  handleAdminGetUser,
  handleAdminUpdateUser,
  handleAdminGetContent,
  handleAdminContentAction,
  handleAdminReports,
  handleAdminAppeals,
  handleAdminBroadcast,
  handleAdminSessions,
  handleAdminLog
} from "./handlers/adminHandlers.js";

interface ExtendedSocket extends WebSocket {
  isAlive: boolean;
  clientIp: string;
  subscribedRooms: Set<string>;
  userId?: string;
  isVisible?: boolean;
  lastActiveAt?: number;
}

export function createWebSocketServer(server: any) {
  const wss = new WebSocketServer({ server, path: "/Server1" });
  const allSockets = new Set<ExtendedSocket>();
  const roomSubscriptions = new Map<string, Set<ExtendedSocket>>();

  configurePush();
  startNotificationMaintenance();

  // Realtime notifications follow the same server push convention as likes and
  // chats: the client dispatches Body.ClientFunction by name.
  setNotificationBroadcaster((userId: string, notification: any, unread: number) => {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "NotificationReceived",
        Notification: notification,
        Unread: unread
      }
    });
    for (const s of allSockets) {
      if (s.userId === userId && s.readyState === WebSocket.OPEN) {
        s.send(packet);
      }
    }
  });

  // A user with an open socket is already receiving the realtime packet, so the
  // Web Push sender can skip their devices on that account.
  setActiveUserChecker((userId: string) => {
    const now = Date.now();
    for (const s of allSockets) {
      if (s.userId !== userId || s.readyState !== WebSocket.OPEN) continue;
      // Only treat the user as active when a visible, recently active client
      // is connected. Backgrounded/closed clients should still receive push.
      if (s.isVisible === false) continue;
      if (!s.lastActiveAt || now - s.lastActiveAt > 45000) continue;
      return true;
    }
    return false;
  });

  function getRoomCount(postId: string): number {
    return roomSubscriptions.get(postId)?.size || 0;
  }

  function subscribeRooms(socket: ExtendedSocket, postIds: string[]) {
    for (const pid of postIds) {
      if (!roomSubscriptions.has(pid)) {
        roomSubscriptions.set(pid, new Set());
      }
      roomSubscriptions.get(pid)!.add(socket);
      socket.subscribedRooms.add(pid);
    }
  }

  function unsubscribeAll(socket: ExtendedSocket) {
    allSockets.delete(socket);
    for (const pid of socket.subscribedRooms) {
      roomSubscriptions.get(pid)?.delete(socket);
      if (roomSubscriptions.get(pid)?.size === 0) {
        roomSubscriptions.delete(pid);
      }
    }
    socket.subscribedRooms.clear();
  }

  function broadcastNewPost(post: any, author: any) {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "DisplayNewPostMessage",
        NewPostData: { UserID: author._id, User: author.User },
        Post: post,
        User: author
      }
    });
    // Send this to every open socket, including the author's other tabs. The
    // author's client handles its own posts automatically (no refresh banner),
    // while other viewers are offered the refresh bar when appropriate.
    for (const s of allSockets) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(packet);
      }
    }
  }

  function broadcastPostLikes(postId: string, likes: number, userId: string, liked: boolean) {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "UpdatePostLikes",
        PostID: postId,
        Likes: likes,
        LikedBy: userId,
        IsLiked: liked
      }
    });
    for (const s of allSockets) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(packet);
      }
    }
  }

  function broadcastChatLikes(chatId: string, postId: string, likes: number, userId: string, liked: boolean) {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "UpdateChatLikes",
        ChatID: chatId,
        PostID: postId,
        Likes: likes,
        LikedBy: userId,
        IsLiked: liked
      }
    });
    for (const s of allSockets) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(packet);
      }
    }
  }

  function broadcastChat(postId: string, chat: any, author: any, reply?: any) {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "NewChatRecieve",
        Chats: [chat],
        Users: [author],
        Replies: reply ? [reply] : undefined
      }
    });

    // Deliver to every open socket. Clients ignore messages for posts that are
    // not on screen, and this guarantees delivery even if a client has not
    // finished subscribing to the room yet (e.g. right after a reconnect).
    for (const s of allSockets) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(packet);
      }
    }
  }

  function broadcastUpdatedChat(postId: string, chatId: string, text: string, editedAt: number) {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "ChatUpdated",
        PostID: postId,
        ChatID: chatId,
        Text: text,
        EditedAt: editedAt
      }
    });

    for (const s of allSockets) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(packet);
      }
    }
  }

  function broadcastDeletedChat(postId: string, chatId: string) {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "NewChatDeleted",
        ChatIDs: [chatId]
      }
    });

    for (const s of allSockets) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(packet);
      }
    }
  }

  function broadcastUpdatedPost(postId: string, text: string, editedAt: number) {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "PostUpdated",
        PostID: postId,
        Text: text,
        EditedAt: editedAt
      }
    });

    for (const s of allSockets) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(packet);
      }
    }
  }

  function broadcastDeletedPost(postId: string) {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "NewPostDeleted",
        PostIDs: [postId]
      }
    });

    for (const s of allSockets) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(packet);
      }
    }
  }

  function pushBanToUser(userId: string, banData: any) {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "UserBanDisplay",
        ...banData
      }
    });
    for (const s of allSockets) {
      if (s.userId === userId && s.readyState === WebSocket.OPEN) {
        s.send(packet);
      }
    }
  }

  function sendToAll(body: any): number {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: body
    });
    let delivered = 0;
    for (const s of allSockets) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(packet);
        delivered++;
      }
    }
    return delivered;
  }

  function pushSessionRevoked(userId: string, ip?: string | null) {
    const packet = JSON.stringify({
      Metadata: { ReqSource: "Server" },
      Body: {
        ClientFunction: "AdminSessionRevoked",
        Reason: ip ? "Your session on this device was signed out by an administrator." : "An administrator signed out all of your sessions."
      }
    });
    for (const s of allSockets) {
      if (s.userId === userId && s.readyState === WebSocket.OPEN && (!ip || s.clientIp === ip)) {
        s.userId = undefined;
        s.send(packet);
      }
    }
  }

  // Admin handlers return data plus a few side-effect hints. This keeps the
  // handlers independent from the socket layer while still broadcasting the
  // same real-time packets normal moderation already uses.
  function applyAdminResultEffects(result: any): void {
    if (!result || result.Code !== 200) return;

    if (result.BanTarget) {
      pushBanToUser(result.BanTarget.UserID, result.BanTarget.BanData);
    }
    if (result.RevokeSessionsFor) {
      pushSessionRevoked(result.RevokeSessionsFor, result.RevokeIP || null);
    }
    if (Array.isArray(result.DeletedPostIDs)) {
      for (const id of result.DeletedPostIDs) {
        if (id) broadcastDeletedPost(id);
      }
    }
    if (Array.isArray(result.DeletedChatIDs)) {
      for (const id of result.DeletedChatIDs) {
        if (id) broadcastDeletedChat("", id);
      }
    }
    if (Array.isArray(result.RestoredPostIDs) || Array.isArray(result.RestoredChatIDs)) {
      sendToAll({ ClientFunction: "AdminForceRefresh", Mode: "Feed", Message: null });
    }
    if (result.Broadcast) {
      const broadcast = result.Broadcast;
      const clientFunction = broadcast.Mode === "Announcement" ? "AdminAnnouncement" : "AdminForceRefresh";
      result.Delivered = sendToAll({
        ClientFunction: clientFunction,
        Mode: broadcast.Mode,
        Message: broadcast.Message,
        Level: broadcast.Level
      });
      delete result.Broadcast;
    }
  }

  wss.on("connection", (socket: ExtendedSocket, req: IncomingMessage) => {
    socket.isAlive = true;
    socket.isVisible = true;
    socket.lastActiveAt = Date.now();
    socket.clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";
    socket.subscribedRooms = new Set();
    allSockets.add(socket);

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("close", () => {
      unsubscribeAll(socket);
      allSockets.delete(socket);
    });

    socket.on("message", (raw) => {
      const msg = raw.toString();
      if (msg === "Ping") {
        socket.isAlive = true;
        socket.lastActiveAt = Date.now();
        socket.send("Pong");
        return;
      }

      let packet: ClientRequestPacket;
      try {
        packet = JSON.parse(msg);
      } catch (err) {
        return;
      }

      const { Metadata, Body } = packet;
      if (!Metadata || !Metadata.ReqTask) return;

      if (Metadata.ReqTask === "UpdateVisibility") {
        socket.isVisible = Body?.Visible !== false;
        socket.lastActiveAt = Date.now();
        socket.send(JSON.stringify({ Metadata: { ReqSource: "Server", SentMetadata: { ReqID: Metadata.ReqID } }, Body: { Code: 200 } }));
        return;
      }

      // Validate session if AuthToken is provided
      let currentUser: UserRecord | null = null;
      if (Metadata.AuthToken && Metadata.UserID) {
        currentUser = validateSession(Metadata.AuthToken, Metadata.UserID, socket.clientIp);
        if (currentUser) {
          socket.userId = currentUser.id;
        }
      }

      let result: any = { Code: 404, Message: `Unknown task ${Metadata.ReqTask}` };

      try {
        switch (Metadata.ReqTask) {
          case "CreateConnection":
            result = handleCreateConnection();
            break;
          case "SignUpAccount":
            result = handleSignUpAccount(Body, socket.clientIp);
            if (result.Code === 200) socket.userId = result.UserID;
            break;
          case "SignInAccount":
            result = handleSignInAccount(Body, socket.clientIp);
            if (result.Code === 200) socket.userId = result.UserID;
            break;
          case "GetAccountData":
            result = handleGetAccountData(currentUser);
            break;
          case "LogoutAccount":
            result = handleLogoutAccount(Metadata.AuthToken);
            delete socket.userId;
            break;
          case "UsernameAvailability":
            result = handleUsernameAvailability(Body);
            break;

          // Posts
          case "GetPosts":
            result = handleGetPosts(Body, currentUser);
            break;
          case "CreatePost":
            result = handleCreatePost(Body, currentUser, broadcastNewPost);
            break;
          case "UpdatePost":
            result = handleUpdatePost(Body, currentUser, broadcastDeletedPost, broadcastUpdatedPost);
            break;
          case "LikePost":
            result = handleLikePost(Body, currentUser, broadcastPostLikes);
            break;
          case "UnlikePost":
            result = handleUnlikePost(Body, currentUser, broadcastPostLikes);
            break;

          // Chats
          case "ConnectLiveChat":
            result = handleConnectLiveChat(Body, (pids) => subscribeRooms(socket, pids), currentUser);
            break;
          case "GetChats":
            result = handleGetChats(Body, currentUser);
            break;
          case "CreateChat":
            result = handleCreateChat(Body, currentUser, broadcastChat);
            // Make sure the sender is part of the room so live counts and
            // subsequent broadcasts include their socket immediately.
            if (result.Code === 200 && Body?.PostID) {
              subscribeRooms(socket, [Body.PostID]);
            }
            break;
          case "UpdateChat":
            result = handleUpdateChat(Body, currentUser, broadcastDeletedChat, broadcastUpdatedChat);
            break;
          case "LikeChat":
            result = handleLikeChat(Body, currentUser, broadcastChatLikes);
            break;
          case "UnlikeChat":
            result = handleUnlikeChat(Body, currentUser, broadcastChatLikes);
            break;
          case "GetLiveCount":
            result = handleGetLiveCount(Body, getRoomCount);
            break;

          // Profiles & Social
          case "GetProfile":
            result = handleGetProfile(Body, currentUser);
            break;
          case "GetUserInfo":
            result = handleGetUserInfo(Body);
            break;
          case "FollowUser":
            result = handleFollowUser(Body, currentUser);
            break;
          case "UnfollowUser":
            result = handleUnfollowUser(Body, currentUser);
            break;
          case "GetFollowData":
            result = handleGetFollowData(Body);
            break;
          case "GetProfileLikes":
            result = handleGetProfileLikes(Body, currentUser);
            break;
          case "GetProfileChats":
            result = handleGetProfileChats(Body, currentUser);
            break;
          case "Search":
            result = handleSearch(Body);
            break;

          // Settings & Sessions
          case "UpdateAccountData":
            result = handleUpdateAccountData(Body, currentUser);
            break;
          case "GetActiveDevices":
            result = handleGetActiveDevices(currentUser, socket.clientIp);
            break;
          case "SignOutSession":
            result = handleSignOutSession(Body, currentUser);
            break;
          case "ManageAccount":
            result = handleManageAccount(Body, currentUser);
            break;
          case "AddBlockedUser":
            result = handleAddBlockedUser(Body, currentUser);
            break;
          case "GetBlockedUsers":
            result = handleGetBlockedUsers(currentUser);
            break;
          case "UnblockUsers":
            result = handleUnblockUsers(Body, currentUser);
            break;

          // Moderation & Webhooks
          case "ModerateUserAction":
            result = handleModerateUserAction(Body, currentUser, pushBanToUser);
            break;
          case "SendBanAppeal":
            result = handleSendBanAppeal(Body, currentUser);
            break;
          case "UnbanUser":
            result = handleUnbanUser(Body, currentUser);
            break;
          case "PostWebhook":
            result = handlePostWebhook(Body, currentUser);
            break;

          // Admin panel
          case "AdminOverview":
            result = handleAdminOverview(currentUser);
            if (result.Code === 200) result.ConnectedClients = allSockets.size;
            break;
          case "AdminUsers":
            result = handleAdminGetUsers(Body, currentUser);
            break;
          case "AdminUserDetail":
            result = handleAdminGetUser(Body, currentUser);
            break;
          case "AdminUpdateUser":
            result = handleAdminUpdateUser(Body, currentUser);
            applyAdminResultEffects(result);
            break;
          case "AdminContent":
            result = handleAdminGetContent(Body, currentUser);
            break;
          case "AdminContentAction":
            result = handleAdminContentAction(Body, currentUser);
            applyAdminResultEffects(result);
            break;
          case "AdminReports":
            result = handleAdminReports(Body, currentUser);
            applyAdminResultEffects(result);
            break;
          case "AdminAppeals":
            result = handleAdminAppeals(Body, currentUser);
            break;
          case "AdminBroadcast":
            result = handleAdminBroadcast(Body, currentUser);
            applyAdminResultEffects(result);
            break;
          case "AdminSessions":
            result = handleAdminSessions(Body, currentUser);
            applyAdminResultEffects(result);
            break;
          case "AdminLog":
            result = handleAdminLog(currentUser);
            break;

          // Notifications & Web Push
          case "GetNotifications":
            result = handleGetNotifications(Body, currentUser);
            break;
          case "GetNotificationCount":
            result = handleGetNotificationCount(currentUser);
            break;
          case "MarkNotificationsRead":
            result = handleMarkNotificationsRead(Body, currentUser);
            break;
          case "MarkAllNotificationsRead":
            result = handleMarkAllNotificationsRead(currentUser);
            break;
          case "GetNotificationSettings":
            result = handleGetNotificationSettings(currentUser);
            break;
          case "UpdateNotificationSettings":
            result = handleUpdateNotificationSettings(Body, currentUser);
            break;
          case "MarkInstallPromptSeen":
            result = handleMarkInstallPromptSeen(currentUser);
            break;
          case "SubscribePush":
            result = handleSubscribePush(Body, currentUser);
            break;
          case "UnsubscribePush":
            result = handleUnsubscribePush(Body, currentUser);
            break;
          case "GetPushStatus":
            result = handleGetPushStatus(currentUser);
            break;
          case "NotificationStats":
            result = handleNotificationStats(currentUser);
            break;

          // Stubs for third-party embeds
          case "LinkPreview":
            result = { Code: 200, Links: {} };
            break;
          case "LoadPlatformEmbeds":
            result = handleLoadPlatformEmbeds(Body);
            break;
          case "Analytics":
            result = { Code: 200 };
            break;
          default:
            result = { Code: 200 };
            break;
        }
      } catch (err: any) {
        console.error(`Error handling task ${Metadata.ReqTask}:`, err);
        result = { Code: 500, Message: err.message };
      }

      // Send RPC response
      const response = {
        Metadata: {
          ReqSource: "Client",
          SentMetadata: Metadata
        },
        Body: result
      };

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(response));
      }
    });
  });

  return wss;
}
