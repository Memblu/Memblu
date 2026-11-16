import { db } from "../db.js";
import { ChatRecord, PostRecord } from "../types.js";

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

// Resolves the posts/chats referenced by "/Post_<id>" and "/Chat_<id>" text.
// The client keys embeds as "<AssetType><AssetID>" (for example "Postabc123")
// and looks up authors in the separate UserData map.
export function handleLoadPlatformEmbeds(body: any): any {
  const embeds = Array.isArray(body?.Embeds) ? body.Embeds : [];

  const postIds: string[] = [];
  const chatIds: string[] = [];
  for (const embed of embeds) {
    if (embed == null || typeof embed.AssetID !== "string") {
      continue;
    }
    if (embed.AssetType === "Post" && !postIds.includes(embed.AssetID)) {
      postIds.push(embed.AssetID);
    } else if (embed.AssetType === "Chat" && !chatIds.includes(embed.AssetID)) {
      chatIds.push(embed.AssetID);
    }
  }

  const EmbedData: Record<string, any> = {};
  const userIds = new Set<string>();
  const replyIds = new Set<string>();

  if (postIds.length > 0) {
    const postRows = db.prepare(`
      SELECT * FROM posts WHERE id IN (${placeholders(postIds.length)}) AND deleted = 0
    `).all(...postIds) as unknown as PostRecord[];

    for (const post of postRows) {
      EmbedData["Post" + post.id] = {
        _id: post.id,
        UserID: post.user_id,
        Text: post.text,
        Timestamp: post.timestamp,
        Likes: post.likes || 0,
        Quotes: post.quotes || 0,
        Chats: post.chats || 0,
        Media: post.media ? JSON.parse(post.media) : undefined,
        Configuration: post.configuration ? JSON.parse(post.configuration) : []
      };
      userIds.add(post.user_id);
    }
  }

  if (chatIds.length > 0) {
    const chatRows = db.prepare(`
      SELECT * FROM chats WHERE id IN (${placeholders(chatIds.length)}) AND hidden = 0
    `).all(...chatIds) as unknown as ChatRecord[];

    for (const chat of chatRows) {
      EmbedData["Chat" + chat.id] = {
        _id: chat.id,
        PostID: chat.post_id,
        UserID: chat.user_id,
        Text: chat.text,
        Timestamp: chat.timestamp,
        ReplyID: chat.reply_id || undefined,
        Likes: chat.likes || 0
      };
      userIds.add(chat.user_id);
      if (chat.reply_id) {
        replyIds.add(chat.reply_id);
      }
    }
  }

  // Chat embeds show the message being replied to directly above the quoted chat.
  if (replyIds.size > 0) {
    const replyIdList = Array.from(replyIds);
    const replyRows = db.prepare(`
      SELECT * FROM chats WHERE id IN (${placeholders(replyIdList.length)})
    `).all(...replyIdList) as unknown as ChatRecord[];

    for (const chat of replyRows) {
      EmbedData["Chat" + chat.id] = {
        _id: chat.id,
        PostID: chat.post_id,
        UserID: chat.user_id,
        Text: chat.text,
        Timestamp: chat.timestamp,
        ReplyID: chat.reply_id || undefined,
        Likes: chat.likes || 0
      };
      userIds.add(chat.user_id);
    }
  }

  const UserData: Record<string, any> = {};
  if (userIds.size > 0) {
    const userIdList = Array.from(userIds);
    const userRows = db.prepare(`
      SELECT id, user, role, settings FROM users
      WHERE id IN (${placeholders(userIdList.length)})
    `).all(...userIdList) as any[];

    for (const user of userRows) {
      UserData[user.id] = {
        _id: user.id,
        User: user.user,
        Role: user.role,
        Settings: JSON.parse(user.settings || "{}")
      };
    }

    // Keep the client from reading undefined author fields if an account was
    // removed after one of its posts or chats was written.
    for (const userId of userIdList) {
      if (UserData[userId] == null) {
        UserData[userId] = {
          _id: userId,
          User: "Deleted",
          Role: "User",
          Settings: {}
        };
      }
    }
  }

  return { Code: 200, EmbedData, UserData };
}
