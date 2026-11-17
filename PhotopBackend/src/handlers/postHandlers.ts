import { db } from "../db.js";
import { generateId } from "../auth.js";
import { UserRecord, PostRecord } from "../types.js";
import { notifyPostCreated, notifyPostLiked, notifyPostUnliked, removeNotificationsForPost } from "../notifications.js";

export function handleGetPosts(body: any, currentUser: UserRecord | null): any {
  const { LookupID, Amount = 15, Before, FromUserID, ExcludePinned } = body;

  let posts: PostRecord[] = [];

  if (LookupID) {
    const single = db.prepare(`
      SELECT * FROM posts WHERE id = ? AND deleted = 0
    `).get(LookupID) as PostRecord | undefined;
    if (single) {
      posts = [single];
    }
  } else {
    const limit = Math.min(Math.max(Number(Amount) || 15, 1), 50);
    const conditions: string[] = ["deleted = 0"];
    const params: any[] = [];

    if (Before != null) {
      conditions.push("timestamp < ?");
      params.push(Number(Before));
    }

    if (FromUserID) {
      conditions.push("user_id = ?");
      params.push(FromUserID);
    }

    if (ExcludePinned && FromUserID) {
      const author = db.prepare("SELECT profile_data FROM users WHERE id = ?").get(FromUserID) as { profile_data: string } | undefined;
      if (author) {
        const pd = JSON.parse(author.profile_data || "{}");
        if (pd.PinnedPost) {
          conditions.push("id != ?");
          params.push(pd.PinnedPost);
        }
      }
    }

    const query = `
      SELECT * FROM posts
      WHERE ${conditions.join(" AND ")}
      ORDER BY timestamp DESC
      LIMIT ?
    `;
    params.push(limit);

    posts = db.prepare(query).all(...params) as unknown as PostRecord[];
  }

  // Collect distinct author user IDs
  const userIds = Array.from(new Set(posts.map(p => p.user_id)));
  const users: any[] = [];
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => "?").join(",");
    const userRows = db.prepare(`
      SELECT id, user, role, settings FROM users WHERE id IN (${placeholders})
    `).all(...userIds) as any[];

    for (const u of userRows) {
      users.push({
        _id: u.id,
        User: u.user,
        Role: u.role,
        Settings: JSON.parse(u.settings || "{}")
      });
    }
  }

  // Collect likes for current user
  const likes: any[] = [];
  if (currentUser && posts.length > 0) {
    const postIds = posts.map(p => p.id);
    const placeholders = postIds.map(() => "?").join(",");
    const likeRows = db.prepare(`
      SELECT id FROM likes WHERE user_id = ? AND post_id IN (${placeholders})
    `).all(currentUser.id, ...postIds) as any[];

    for (const l of likeRows) {
      likes.push({ _id: l.id });
    }
  }

  const mappedPosts = posts.map(p => ({
    _id: p.id,
    UserID: p.user_id,
    Text: p.text,
    Timestamp: p.timestamp,
    Likes: p.likes || 0,
    Quotes: p.quotes || 0,
    Chats: p.chats || 0,
    Media: p.media ? JSON.parse(p.media) : undefined,
    Configuration: p.configuration ? JSON.parse(p.configuration) : [],
    EditedAt: p.edited_at || null
  }));

  return {
    Code: 200,
    Posts: mappedPosts,
    Users: users,
    Likes: likes
  };
}

export function handleCreatePost(
  body: any,
  currentUser: UserRecord | null,
  broadcastNewPost: (post: any, author: any) => void
): any {
  if (!currentUser) {
    return { Code: 401, Message: "Not authenticated." };
  }

  const { Text, Media, Configuration } = body;
  if (!Text && (!Media || !Media.ImageCount)) {
    return { Code: 400, Message: "Post must have text or media." };
  }

  const newPostId = generateId();
  const now = Date.now();

  db.prepare(`
    INSERT INTO posts (id, user_id, text, timestamp, likes, quotes, chats, media, configuration, deleted)
    VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, 0)
  `).run(
    newPostId,
    currentUser.id,
    Text || "",
    now,
    Media ? JSON.stringify(Media) : null,
    Configuration ? JSON.stringify(Configuration) : "[]"
  );

  const post = {
    _id: newPostId,
    UserID: currentUser.id,
    Text: Text || "",
    Timestamp: now,
    Likes: 0,
    Quotes: 0,
    Chats: 0,
    Media: Media || undefined,
    Configuration: Configuration || []
  };
  const author = {
    _id: currentUser.id,
    User: currentUser.user,
    Role: currentUser.role,
    Settings: JSON.parse(currentUser.settings || "{}")
  };

  broadcastNewPost(post, author);
  notifyPostCreated({ actorId: currentUser.id, postId: newPostId, text: Text || "" });

  return {
    Code: 200,
    NewPostID: newPostId
  };
}

export type BroadcastDeletedPost = (postId: string) => void;
export type BroadcastUpdatedPost = (postId: string, text: string, editedAt: number) => void;

export function handleUpdatePost(
  body: any,
  currentUser: UserRecord | null,
  broadcastDeletedPost?: BroadcastDeletedPost,
  broadcastUpdatedPost?: BroadcastUpdatedPost
): any {
  if (!currentUser) {
    return { Code: 401, Message: "Not authenticated." };
  }

  const { Task, PostID } = body;
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(PostID) as PostRecord | undefined;
  if (!post) {
    return { Code: 404, Message: "Post not found." };
  }

  const isAuthor = post.user_id === currentUser.id;
  const canMod = currentUser.role === "Owner" || currentUser.role === "Moderator";

  if (Task === "Edit") {
    // Only the author may rewrite their own words; moderators can delete but
    // must not speak for someone else.
    if (!isAuthor) {
      return { Code: 403, Message: "You can only edit your own posts." };
    }
    if (post.deleted === 1) {
      return { Code: 404, Message: "Post not found." };
    }

    const Text = typeof body.Text === "string" ? body.Text : null;
    if (Text == null) {
      return { Code: 400, Message: "Missing post text." };
    }
    let hasMedia = false;
    try {
      const media = post.media ? JSON.parse(post.media) : null;
      hasMedia = !!(media && media.ImageCount);
    } catch {
      hasMedia = false;
    }
    if (!Text.trim() && !hasMedia) {
      return { Code: 400, Message: "Post must have text or media." };
    }
    if (Text.length > 400) {
      return { Code: 400, Message: "Posts can be up to 400 characters long." };
    }

    const editedAt = Date.now();
    db.prepare("UPDATE posts SET text = ?, edited_at = ? WHERE id = ?").run(Text, editedAt, PostID);
    if (broadcastUpdatedPost) {
      broadcastUpdatedPost(PostID, Text, editedAt);
    }
    return { Code: 200, PostID, Text, EditedAt: editedAt };
  }

  if (Task === "Delete") {
    if (!isAuthor && !canMod) {
      return { Code: 403, Message: "Permission denied." };
    }
    db.prepare("UPDATE posts SET deleted = 1 WHERE id = ?").run(PostID);
    db.prepare("UPDATE users SET profile_data = replace(profile_data, ?, '') WHERE profile_data LIKE ?").run(`"PinnedPost":"${PostID}"`, `%"PinnedPost":"${PostID}"%`);
    removeNotificationsForPost(PostID);
    if (broadcastDeletedPost) {
      broadcastDeletedPost(PostID);
    }
    return { Code: 200 };
  }

  if (Task === "PinProfile" && isAuthor) {
    const profileData = JSON.parse(currentUser.profile_data || "{}");
    profileData.PinnedPost = PostID;
    db.prepare("UPDATE users SET profile_data = ? WHERE id = ?").run(JSON.stringify(profileData), currentUser.id);
    return { Code: 200 };
  }

  if (Task === "UnpinProfile" && isAuthor) {
    const profileData = JSON.parse(currentUser.profile_data || "{}");
    profileData.PinnedPost = "";
    db.prepare("UPDATE users SET profile_data = ? WHERE id = ?").run(JSON.stringify(profileData), currentUser.id);
    return { Code: 200 };
  }

  return { Code: 200 };
}

export type BroadcastPostLikes = (postId: string, likes: number, userId: string, liked: boolean) => void;

function getPostLikeCount(postId: string): number {
  const row = db.prepare("SELECT likes FROM posts WHERE id = ?").get(postId) as { likes: number } | undefined;
  return row ? row.likes : 0;
}

export function handleLikePost(body: any, currentUser: UserRecord | null, broadcastLikes?: BroadcastPostLikes): any {
  if (!currentUser) {
    return { Code: 401, Message: "Not authenticated." };
  }

  const { PostID } = body;
  if (!PostID) return { Code: 400 };

  const likeId = `${PostID}${currentUser.id}`;
  const existing = db.prepare("SELECT id FROM likes WHERE id = ?").get(likeId);
  if (!existing) {
    db.prepare("INSERT INTO likes (id, post_id, user_id, timestamp) VALUES (?, ?, ?, ?)").run(likeId, PostID, currentUser.id, Date.now());
    db.prepare("UPDATE posts SET likes = likes + 1 WHERE id = ?").run(PostID);
  }

  const likes = getPostLikeCount(PostID);
  if (broadcastLikes) broadcastLikes(PostID, likes, currentUser.id, true);
  notifyPostLiked({ actorId: currentUser.id, postId: PostID });

  return { Code: 200, PostID, Likes: likes, IsLiked: true };
}

export function handleUnlikePost(body: any, currentUser: UserRecord | null, broadcastLikes?: BroadcastPostLikes): any {
  if (!currentUser) {
    return { Code: 401, Message: "Not authenticated." };
  }

  const { PostID } = body;
  if (!PostID) return { Code: 400 };

  const likeId = `${PostID}${currentUser.id}`;
  const existing = db.prepare("SELECT id FROM likes WHERE id = ?").get(likeId);
  if (existing) {
    db.prepare("DELETE FROM likes WHERE id = ?").run(likeId);
    db.prepare("UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?").run(PostID);
  }

  const likes = getPostLikeCount(PostID);
  if (broadcastLikes) broadcastLikes(PostID, likes, currentUser.id, false);
  notifyPostUnliked({ actorId: currentUser.id, postId: PostID });

  return { Code: 200, PostID, Likes: likes, IsLiked: false };
}
