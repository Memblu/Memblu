import { db } from "../db.js";
import { UserRecord, PostRecord, ChatRecord, LikeRecord } from "../types.js";
import { handleGetPosts } from "./postHandlers.js";
import { formatChatResponse } from "./chatHandlers.js";

export function handleGetProfile(body: any, currentUser: UserRecord | null): any {
  const { ProfileUserID } = body;
  if (!ProfileUserID) return { Code: 404 };

  // Profiles can be addressed by the account's user ID or its custom profile
  // URL (for example `?user=wrapjs`). IDs take priority so an existing share
  // link always resolves to the same account.
  let target = db.prepare("SELECT * FROM users WHERE id = ?").get(ProfileUserID) as UserRecord | undefined;
  if (!target) {
    target = db.prepare("SELECT * FROM users WHERE custom_url = ? COLLATE NOCASE").get(ProfileUserID) as UserRecord | undefined;
  }
  if (!target) return { Code: 404, Message: "User not found." };

  const targetID = target.id;

  if (currentUser) {
    const userBlocked = JSON.parse(currentUser.blocked_users || "[]");
    if (userBlocked.includes(targetID)) {
      return { Code: 403, Message: "You have blocked this user." };
    }
  }

  let isFollowing = false;
  if (currentUser) {
    const follow = db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND target_id = ?").get(currentUser.id, targetID);
    isFollowing = !!follow;
  }

  // The client renders all three profile tabs (Posts, Chats, Likes) from this one response,
  // so it has to carry the first page of each. Later pages come from GetPosts/GetProfileChats/
  // GetProfileLikes via infinite scroll.
  const postsPage = handleGetPosts({ FromUserID: targetID, Amount: 15 }, currentUser);
  const chatsPage = handleGetProfileChats({ GetUserID: targetID, Amount: 25 }, currentUser);
  const likesPage = handleGetProfileLikes({ GetUserID: targetID, Amount: 15 }, currentUser);

  // "Likes" marks which posts the *viewer* has liked, across both the Posts and Likes tabs.
  const viewerLikes = new Map<string, { _id: string }>();
  for (const l of [...(postsPage.Likes || []), ...(likesPage.Likes || [])]) {
    viewerLikes.set(l._id, l);
  }

  return {
    Code: 200,
    UserInfo: {
      _id: target.id,
      User: target.user,
      CustomURL: target.custom_url || null,
      Role: target.role,
      CreationTime: target.creation_time,
      Settings: JSON.parse(target.settings || "{}"),
      ProfileData: JSON.parse(target.profile_data || "{}"),
      SetLocation: target.set_location || null
    },
    IsFollowing: isFollowing,
    Posts: postsPage.Posts || [],
    Chats: chatsPage.Chats || [],
    Replies: chatsPage.Replies || [],
    LikePostData: likesPage.LikePostData || [],
    UserLikePosts: likesPage.Posts || [],
    UserLikePostUsers: likesPage.Users || [],
    Likes: Array.from(viewerLikes.values())
  };
}

export function handleGetUserInfo(body: any): any {
  const { GetUserID } = body;
  if (!GetUserID) return { Code: 404 };

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(GetUserID) as UserRecord | undefined;
  if (!user) return { Code: 404 };

  return {
    Code: 200,
    UserInfo: {
      _id: user.id,
      User: user.user,
      Role: user.role,
      Settings: JSON.parse(user.settings || "{}"),
      ProfileData: JSON.parse(user.profile_data || "{}")
    }
  };
}

export function handleFollowUser(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401 };
  const { FollowUserID } = body;
  if (!FollowUserID || FollowUserID === currentUser.id) return { Code: 400 };

  const existing = db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND target_id = ?").get(currentUser.id, FollowUserID);
  if (!existing) {
    db.prepare("INSERT INTO follows (follower_id, target_id, timestamp) VALUES (?, ?, ?)").run(currentUser.id, FollowUserID, Date.now());

    // Update target followers count
    const target = db.prepare("SELECT profile_data FROM users WHERE id = ?").get(FollowUserID) as { profile_data: string } | undefined;
    if (target) {
      const pd = JSON.parse(target.profile_data || "{}");
      pd.Followers = (pd.Followers || 0) + 1;
      db.prepare("UPDATE users SET profile_data = ? WHERE id = ?").run(JSON.stringify(pd), FollowUserID);
    }

    // Update currentUser following count
    const pd = JSON.parse(currentUser.profile_data || "{}");
    pd.Following = (pd.Following || 0) + 1;
    db.prepare("UPDATE users SET profile_data = ? WHERE id = ?").run(JSON.stringify(pd), currentUser.id);
  }

  return { Code: 200 };
}

export function handleUnfollowUser(body: any, currentUser: UserRecord | null): any {
  if (!currentUser) return { Code: 401 };
  const { UnfollowUserID } = body;
  if (!UnfollowUserID) return { Code: 400 };

  const existing = db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND target_id = ?").get(currentUser.id, UnfollowUserID);
  if (existing) {
    db.prepare("DELETE FROM follows WHERE follower_id = ? AND target_id = ?").run(currentUser.id, UnfollowUserID);

    // Update target followers count
    const target = db.prepare("SELECT profile_data FROM users WHERE id = ?").get(UnfollowUserID) as { profile_data: string } | undefined;
    if (target) {
      const pd = JSON.parse(target.profile_data || "{}");
      pd.Followers = Math.max(0, (pd.Followers || 0) - 1);
      db.prepare("UPDATE users SET profile_data = ? WHERE id = ?").run(JSON.stringify(pd), UnfollowUserID);
    }

    // Update currentUser following count
    const pd = JSON.parse(currentUser.profile_data || "{}");
    pd.Following = Math.max(0, (pd.Following || 0) - 1);
    db.prepare("UPDATE users SET profile_data = ? WHERE id = ?").run(JSON.stringify(pd), currentUser.id);
  }

  return { Code: 200 };
}

export function handleGetFollowData(body: any): any {
  const { Type, GetUserID, Amount = 25, Before } = body;
  if (!GetUserID || !Type) return { Code: 400 };

  const limit = Math.min(Math.max(Number(Amount) || 25, 1), 50);
  let rows: { follower_id: string; target_id: string; timestamp: number }[] = [];

  if (Type === "Followers") {
    const conditions = ["target_id = ?"];
    const params: any[] = [GetUserID];
    if (Before != null) {
      conditions.push("timestamp < ?");
      params.push(Number(Before));
    }
    rows = db.prepare(`SELECT follower_id, timestamp FROM follows WHERE ${conditions.join(" AND ")} ORDER BY timestamp DESC LIMIT ?`).all(...params, limit) as any[];
  } else {
    const conditions = ["follower_id = ?"];
    const params: any[] = [GetUserID];
    if (Before != null) {
      conditions.push("timestamp < ?");
      params.push(Number(Before));
    }
    rows = db.prepare(`SELECT target_id, timestamp FROM follows WHERE ${conditions.join(" AND ")} ORDER BY timestamp DESC LIMIT ?`).all(...params, limit) as any[];
  }

  const followIds = rows.map(r => Type === "Followers" ? r.follower_id : (r as any).target_id);
  const usersObj: Record<string, any> = {};

  if (followIds.length > 0) {
    const placeholders = followIds.map(() => "?").join(",");
    const userRows = db.prepare(`SELECT id, user, role, settings FROM users WHERE id IN (${placeholders})`).all(...followIds) as any[];
    for (const u of userRows) {
      usersObj[u.id] = {
        User: u.user,
        Role: u.role,
        Settings: JSON.parse(u.settings || "{}")
      };
    }
  }

  const lastTimestamp = rows.length > 0 ? rows[rows.length - 1].timestamp : 0;

  return {
    Code: 200,
    FollowUserIds: followIds,
    Users: usersObj,
    LastTimestamp: lastTimestamp
  };
}

export function handleGetProfileLikes(body: any, currentUser: UserRecord | null): any {
  const { GetUserID, Amount = 15, Before } = body;
  if (!GetUserID) return { Code: 400 };

  const limit = Math.min(Math.max(Number(Amount) || 15, 1), 50);
  const conditions = ["user_id = ?"];
  const params: any[] = [GetUserID];
  if (Before != null) {
    conditions.push("timestamp < ?");
    params.push(Number(Before));
  }

  const likeRows = db.prepare(`
    SELECT * FROM likes WHERE ${conditions.join(" AND ")} ORDER BY timestamp DESC LIMIT ?
  `).all(...params, limit) as unknown as LikeRecord[];

  const postIds = likeRows.map(l => l.post_id);
  let posts: any[] = [];
  let users: any[] = [];
  let userLikes: any[] = [];

  if (postIds.length > 0) {
    const placeholders = postIds.map(() => "?").join(",");
    const postRows = db.prepare(`SELECT * FROM posts WHERE id IN (${placeholders}) AND deleted = 0`).all(...postIds) as unknown as PostRecord[];
    posts = postRows.map(p => ({
      _id: p.id,
      UserID: p.user_id,
      Text: p.text,
      Timestamp: p.timestamp,
      Likes: p.likes || 0,
      Quotes: p.quotes || 0,
      Chats: p.chats || 0,
      Media: p.media ? JSON.parse(p.media) : undefined,
      EditedAt: p.edited_at || null
    }));

    const authorIds = Array.from(new Set(postRows.map(p => p.user_id)));
    if (authorIds.length > 0) {
      const uPlaceholders = authorIds.map(() => "?").join(",");
      const uRows = db.prepare(`SELECT id, user, role, settings FROM users WHERE id IN (${uPlaceholders})`).all(...authorIds) as any[];
      users = uRows.map(u => ({
        _id: u.id,
        User: u.user,
        Role: u.role,
        Settings: JSON.parse(u.settings || "{}")
      }));
    }

    if (currentUser) {
      const lRows = db.prepare(`SELECT id FROM likes WHERE user_id = ? AND post_id IN (${placeholders})`).all(currentUser.id, ...postIds) as any[];
      userLikes = lRows.map(l => ({ _id: l.id }));
    }
  }

  const mappedLikes = likeRows.map(l => ({
    _id: l.id,
    Timestamp: l.timestamp
  }));

  return {
    Code: 200,
    LikePostData: mappedLikes,
    Posts: posts,
    Users: users,
    Likes: userLikes
  };
}

export function handleGetProfileChats(body: any, currentUser: UserRecord | null = null): any {
  const { GetUserID, Amount = 15, Before } = body;
  if (!GetUserID) return { Code: 400 };

  const limit = Math.min(Math.max(Number(Amount) || 15, 1), 50);
  const conditions = ["user_id = ?", "hidden = 0"];
  const params: any[] = [GetUserID];
  if (Before != null) {
    conditions.push("timestamp < ?");
    params.push(Number(Before));
  }

  const chatRows = db.prepare(`
    SELECT * FROM chats WHERE ${conditions.join(" AND ")} ORDER BY timestamp DESC LIMIT ?
  `).all(...params, limit) as unknown as ChatRecord[];

  const formatted = formatChatResponse(chatRows, currentUser);

  return {
    Code: 200,
    Chats: formatted.Chats,
    Replies: formatted.Replies
  };
}

export function handleSearch(body: any): any {
  const { Type, Search } = body;
  if (Type !== "Users" || !Search || !Search.trim()) {
    return { Code: 200, Result: [] };
  }

  const query = `%${Search.trim().toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT id, user, role, settings FROM users WHERE user_lower LIKE ? LIMIT 10
  `).all(query) as any[];

  return {
    Code: 200,
    Result: rows.map(r => ({
      _id: r.id,
      User: r.user,
      Role: r.role,
      Settings: JSON.parse(r.settings || "{}")
    }))
  };
}
