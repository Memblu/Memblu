import { db } from "../db.js";
import { generateId } from "../auth.js";
import { UserRecord, ChatRecord } from "../types.js";
import { notifyChatCreated, notifyChatLiked, notifyChatUnliked, removeNotificationsForChat } from "../notifications.js";

export function handleConnectLiveChat(
  body: any,
  subscribeRooms: (postIds: string[]) => void,
  currentUser: UserRecord | null = null
): any {
  const { Posts = [], ChatPosts = [], Amount = 25 } = body;
  const visiblePosts = Array.isArray(Posts) ? Posts : [];
  const postsToLoad = Array.isArray(ChatPosts) ? ChatPosts : [];
  subscribeRooms(Array.from(new Set([...visiblePosts, ...postsToLoad])));

  const targetPosts = postsToLoad.length > 0 ? postsToLoad : visiblePosts;
  if (targetPosts.length === 0) {
    return { Code: 200, Chats: [], Users: [], Replies: [] };
  }

  const limit = Math.min(Math.max(Number(Amount) || 25, 1), 50);
  const placeholders = targetPosts.map(() => "?").join(",");

  const chatRows = db.prepare(`
    SELECT * FROM chats
    WHERE post_id IN (${placeholders}) AND hidden = 0
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...targetPosts, limit) as unknown as ChatRecord[];

  return formatChatResponse(chatRows, currentUser);
}

export function handleGetChats(body: any, currentUser: UserRecord | null = null): any {
  const { Post, Before, After, Amount = 15, LookupID } = body;

  let chatRows: ChatRecord[] = [];
  const limit = Math.min(Math.max(Number(Amount) || 15, 1), 50);

  if (LookupID) {
    const single = db.prepare("SELECT * FROM chats WHERE id = ? AND hidden = 0").get(LookupID) as ChatRecord | undefined;
    if (single) chatRows = [single];
  } else if (Post) {
    if (Before != null) {
      chatRows = db.prepare(`
        SELECT * FROM chats
        WHERE post_id = ? AND timestamp < ? AND hidden = 0
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(Post, Number(Before), limit) as unknown as ChatRecord[];
    } else if (After != null) {
      chatRows = db.prepare(`
        SELECT * FROM chats
        WHERE post_id = ? AND timestamp > ? AND hidden = 0
        ORDER BY timestamp ASC
        LIMIT ?
      `).all(Post, Number(After), limit) as unknown as ChatRecord[];
    } else {
      chatRows = db.prepare(`
        SELECT * FROM chats
        WHERE post_id = ? AND hidden = 0
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(Post, limit) as unknown as ChatRecord[];
    }
  }

  return formatChatResponse(chatRows, currentUser);
}

export function handleCreateChat(
  body: any,
  currentUser: UserRecord | null,
  broadcastChat: (postId: string, chat: any, author: any, reply?: any) => void
): any {
  if (!currentUser) {
    return { Code: 401, Message: "Not authenticated." };
  }

  const { PostID, Text, ReplyID } = body;
  if (!PostID || !Text || !Text.trim()) {
    return { Code: 400, Message: "Message cannot be empty." };
  }

  const chatId = generateId();
  const now = Date.now();

  db.prepare(`
    INSERT INTO chats (id, post_id, user_id, text, timestamp, reply_id, hidden)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(chatId, PostID, currentUser.id, Text.trim(), now, ReplyID || null);

  db.prepare("UPDATE posts SET chats = chats + 1 WHERE id = ?").run(PostID);

  const newChat = {
    _id: chatId,
    PostID: PostID,
    UserID: currentUser.id,
    Text: Text.trim(),
    Timestamp: now,
    ReplyID: ReplyID || undefined,
    Likes: 0,
    IsLiked: false
  };

  const author = {
    _id: currentUser.id,
    User: currentUser.user,
    Role: currentUser.role,
    Settings: JSON.parse(currentUser.settings || "{}")
  };

  let replyData: any;
  if (ReplyID) {
    replyData = formatReplyPayloads([ReplyID])[0];
  }

  broadcastChat(PostID, newChat, author, replyData);
  notifyChatCreated({
    actorId: currentUser.id,
    chatId,
    postId: PostID,
    text: Text.trim(),
    replyId: ReplyID || null
  });

  return { Code: 200 };
}

export type BroadcastUpdatedChat = (postId: string, chatId: string, text: string, editedAt: number) => void;

export function handleUpdateChat(
  body: any,
  currentUser: UserRecord | null,
  broadcastDeleted: (postId: string, chatId: string) => void,
  broadcastUpdated?: BroadcastUpdatedChat
): any {
  if (!currentUser) {
    return { Code: 401, Message: "Not authenticated." };
  }

  const { ChatID } = body;
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(ChatID) as ChatRecord | undefined;
  if (!chat) {
    return { Code: 404, Message: "Chat not found." };
  }

  const isAuthor = chat.user_id === currentUser.id;
  const canMod = currentUser.role === "Owner" || currentUser.role === "Moderator";

  if (!isAuthor && !canMod) {
    return { Code: 403, Message: "Permission denied." };
  }

  if (body.Task === "Edit") {
    if (!isAuthor) {
      return { Code: 403, Message: "You can only edit your own chats." };
    }
    if (chat.hidden === 1) {
      return { Code: 404, Message: "Chat not found." };
    }
    const Text = typeof body.Text === "string" ? body.Text.trim() : null;
    if (!Text) {
      return { Code: 400, Message: "Message cannot be empty." };
    }
    if (Text.length > 200) {
      return { Code: 400, Message: "Chats can be up to 200 characters long." };
    }

    const editedAt = Date.now();
    db.prepare("UPDATE chats SET text = ?, edited_at = ? WHERE id = ?").run(Text, editedAt, ChatID);
    if (broadcastUpdated) {
      broadcastUpdated(chat.post_id, ChatID, Text, editedAt);
    }
    return { Code: 200, ChatID, PostID: chat.post_id, Text, EditedAt: editedAt };
  }

  db.prepare("UPDATE chats SET hidden = 1 WHERE id = ?").run(ChatID);
  db.prepare("UPDATE posts SET chats = MAX(0, chats - 1) WHERE id = ?").run(chat.post_id);
  removeNotificationsForChat(ChatID);

  broadcastDeleted(chat.post_id, ChatID);

  return { Code: 200 };
}

export type BroadcastChatLikes = (chatId: string, postId: string, likes: number, userId: string, liked: boolean) => void;

function getChatLikeCount(chatId: string): number {
  const row = db.prepare("SELECT likes FROM chats WHERE id = ?").get(chatId) as { likes: number } | undefined;
  return row ? row.likes : 0;
}

export function handleLikeChat(body: any, currentUser: UserRecord | null, broadcastLikes?: BroadcastChatLikes): any {
  if (!currentUser) {
    return { Code: 401, Message: "Not authenticated." };
  }

  const { ChatID } = body;
  if (!ChatID) return { Code: 400 };

  const chat = db.prepare("SELECT id, post_id FROM chats WHERE id = ? AND hidden = 0").get(ChatID) as { id: string; post_id: string } | undefined;
  if (!chat) return { Code: 404, Message: "Chat not found." };

  const likeId = `${ChatID}${currentUser.id}`;
  const existing = db.prepare("SELECT id FROM chat_likes WHERE id = ?").get(likeId);
  if (!existing) {
    db.prepare("INSERT INTO chat_likes (id, chat_id, user_id, timestamp) VALUES (?, ?, ?, ?)").run(likeId, ChatID, currentUser.id, Date.now());
    db.prepare("UPDATE chats SET likes = likes + 1 WHERE id = ?").run(ChatID);
  }

  const likes = getChatLikeCount(ChatID);
  if (broadcastLikes) broadcastLikes(ChatID, chat.post_id, likes, currentUser.id, true);
  notifyChatLiked({ actorId: currentUser.id, chatId: ChatID });

  return { Code: 200, ChatID, PostID: chat.post_id, Likes: likes, IsLiked: true };
}

export function handleUnlikeChat(body: any, currentUser: UserRecord | null, broadcastLikes?: BroadcastChatLikes): any {
  if (!currentUser) {
    return { Code: 401, Message: "Not authenticated." };
  }

  const { ChatID } = body;
  if (!ChatID) return { Code: 400 };

  const chat = db.prepare("SELECT id, post_id FROM chats WHERE id = ? AND hidden = 0").get(ChatID) as { id: string; post_id: string } | undefined;
  if (!chat) return { Code: 404, Message: "Chat not found." };

  const likeId = `${ChatID}${currentUser.id}`;
  const existing = db.prepare("SELECT id FROM chat_likes WHERE id = ?").get(likeId);
  if (existing) {
    db.prepare("DELETE FROM chat_likes WHERE id = ?").run(likeId);
    db.prepare("UPDATE chats SET likes = MAX(0, likes - 1) WHERE id = ?").run(ChatID);
  }

  const likes = getChatLikeCount(ChatID);
  if (broadcastLikes) broadcastLikes(ChatID, chat.post_id, likes, currentUser.id, false);
  notifyChatUnliked({ actorId: currentUser.id, chatId: ChatID });

  return { Code: 200, ChatID, PostID: chat.post_id, Likes: likes, IsLiked: false };
}

export function handleGetLiveCount(body: any, getRoomCount: (postId: string) => number): any {
  const { Posts = [] } = body;
  const counts = Posts.map((postId: string) => [postId, getRoomCount(postId)]);
  return { Code: 200, LiveUserCounts: counts };
}

// The client expects each reply to carry the original author's user data
// (`ReplyData.UserData.User`, role, settings), not just the author's ID.
export function formatReplyPayloads(replyIds: string[]) {
  if (replyIds.length === 0) return [];

  const placeholders = replyIds.map(() => "?").join(",");
  const replyRows = db.prepare(`
    SELECT c.id, c.user_id, c.text, c.timestamp, u.user, u.role, u.settings
    FROM chats c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.id IN (${placeholders})
  `).all(...replyIds) as any[];

  return replyRows.map(r => ({
    _id: r.id,
    UserID: r.user_id,
    Text: r.text,
    Timestamp: r.timestamp,
    UserData: {
      User: r.user ?? "Deleted",
      Role: r.role ?? "User",
      Settings: JSON.parse(r.settings || "{}")
    }
  }));
}

export function formatChatResponse(chatRows: ChatRecord[], currentUser: UserRecord | null = null) {
  const userIds = Array.from(new Set(chatRows.map(c => c.user_id)));
  const users: any[] = [];
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => "?").join(",");
    const userRows = db.prepare(`SELECT id, user, role, settings FROM users WHERE id IN (${placeholders})`).all(...userIds) as any[];
    for (const u of userRows) {
      users.push({
        _id: u.id,
        User: u.user,
        Role: u.role,
        Settings: JSON.parse(u.settings || "{}")
      });
    }
  }

  const replyIds = Array.from(new Set(chatRows.filter(c => c.reply_id).map(c => c.reply_id!)));
  const replies = formatReplyPayloads(replyIds);

  // Which of these chats has the viewer already liked?
  const likedChatIds = new Set<string>();
  if (currentUser && chatRows.length > 0) {
    const chatPlaceholders = chatRows.map(() => "?").join(",");
    const likeRows = db.prepare(`
      SELECT chat_id FROM chat_likes
      WHERE user_id = ? AND chat_id IN (${chatPlaceholders})
    `).all(currentUser.id, ...chatRows.map(c => c.id)) as Array<{ chat_id: string }>;
    for (const row of likeRows) {
      likedChatIds.add(row.chat_id);
    }
  }

  const mappedChats = chatRows.map(c => ({
    _id: c.id,
    PostID: c.post_id,
    UserID: c.user_id,
    Text: c.text,
    Timestamp: c.timestamp,
    ReplyID: c.reply_id || undefined,
    Likes: c.likes || 0,
    IsLiked: likedChatIds.has(c.id),
    EditedAt: c.edited_at || null
  }));

  return {
    Code: 200,
    Chats: mappedChats,
    Users: users,
    Replies: replies
  };
}
