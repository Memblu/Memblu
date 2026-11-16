import { db } from "../db.js";
import { generateId } from "../auth.js";
import { UserRecord, ChatRecord } from "../types.js";

export function handleConnectLiveChat(
  body: any,
  subscribeRooms: (postIds: string[]) => void
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

  return formatChatResponse(chatRows);
}

export function handleGetChats(body: any): any {
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

  return formatChatResponse(chatRows);
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
    ReplyID: ReplyID || undefined
  };

  const author = {
    _id: currentUser.id,
    User: currentUser.user,
    Role: currentUser.role,
    Settings: JSON.parse(currentUser.settings || "{}")
  };

  let replyData: any;
  if (ReplyID) {
    const parentChat = db.prepare("SELECT * FROM chats WHERE id = ?").get(ReplyID) as ChatRecord | undefined;
    if (parentChat) {
      replyData = {
        _id: parentChat.id,
        UserID: parentChat.user_id,
        Text: parentChat.text,
        Timestamp: parentChat.timestamp
      };
    }
  }

  broadcastChat(PostID, newChat, author, replyData);

  return { Code: 200 };
}

export function handleUpdateChat(
  body: any,
  currentUser: UserRecord | null,
  broadcastDeleted: (postId: string, chatId: string) => void
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

  db.prepare("UPDATE chats SET hidden = 1 WHERE id = ?").run(ChatID);
  db.prepare("UPDATE posts SET chats = MAX(0, chats - 1) WHERE id = ?").run(chat.post_id);

  broadcastDeleted(chat.post_id, ChatID);

  return { Code: 200 };
}

export function handleGetLiveCount(body: any, getRoomCount: (postId: string) => number): any {
  const { Posts = [] } = body;
  const counts = Posts.map((postId: string) => [postId, getRoomCount(postId)]);
  return { Code: 200, LiveUserCounts: counts };
}

function formatChatResponse(chatRows: ChatRecord[]) {
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
  const replies: any[] = [];
  if (replyIds.length > 0) {
    const placeholders = replyIds.map(() => "?").join(",");
    const replyRows = db.prepare(`SELECT id, user_id, text, timestamp FROM chats WHERE id IN (${placeholders})`).all(...replyIds) as any[];
    for (const r of replyRows) {
      replies.push({
        _id: r.id,
        UserID: r.user_id,
        Text: r.text,
        Timestamp: r.timestamp
      });
    }
  }

  const mappedChats = chatRows.map(c => ({
    _id: c.id,
    PostID: c.post_id,
    UserID: c.user_id,
    Text: c.text,
    Timestamp: c.timestamp,
    ReplyID: c.reply_id || undefined
  }));

  return {
    Code: 200,
    Chats: mappedChats,
    Users: users,
    Replies: replies
  };
}
