export interface ClientMetadata {
  ReqID: number;
  ReqTask: string;
  Fingerprint?: string;
  AuthToken?: string;
  UserID?: string;
  SettingsHash?: number;
}

export interface ClientRequestPacket {
  Metadata: ClientMetadata;
  Body: Record<string, any>;
}

export interface ServerResponsePacket {
  Metadata: {
    ReqSource: "Client" | "Server";
    SentMetadata?: ClientMetadata;
  };
  Body: {
    Code?: number;
    ClientFunction?: string;
    [key: string]: any;
  };
}

export interface UserRecord {
  id: string;
  user: string;
  user_lower: string;
  custom_url?: string | null;
  email: string;
  password_hash: string;
  role: string; // JSON array or string
  creation_time: number;
  set_location?: string | null;
  settings: string; // JSON: { ProfilePic, ProfileBanner, Display }
  profile_data: string; // JSON: { Bio, PinnedPost, Socials, Followers, Following }
  blocked_users: string; // JSON array
  status: "active" | "disabled" | "pending_delete" | "banned";
  ban_data?: string | null; // JSON: { BanReason, BanExpires, Appealed }
  delete_timeframe?: number | null;
}

export interface PostRecord {
  id: string;
  user_id: string;
  text: string;
  timestamp: number;
  likes: number;
  quotes: number;
  chats: number;
  media?: string | null; // JSON: { ImageCount: number }
  configuration?: string | null; // JSON: string[]
  deleted: number; // 0 or 1
  edited_at?: number | null;
}

export interface ChatRecord {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  timestamp: number;
  reply_id?: string | null;
  hidden: number; // 0 or 1
  likes: number;
  edited_at?: number | null;
}

export interface LikeRecord {
  id: string; // post_id + user_id
  post_id: string;
  user_id: string;
  timestamp: number;
}

export interface FollowRecord {
  follower_id: string;
  target_id: string;
  timestamp: number;
}

export interface SessionRecord {
  token: string;
  user_id: string;
  ip: string;
  last_visit: number;
  expires_at: number;
}

export type NotificationType =
  | "LikePost"
  | "QuotePost"
  | "ChatPost"
  | "ModeratePost"
  | "LikeChat"
  | "ReplyChat"
  | "QuoteChat"
  | "ModerateChat"
  | "MentionPost"
  | "MentionChat"
  | "NewPost"
  | "Follow"
  | "ThreadActivity";

export interface NotificationRecord {
  id: string;
  recipient_id: string;
  type: NotificationType;
  actor_id?: string | null;
  post_id?: string | null;
  chat_id?: string | null;
  group_key: string;
  count: number;
  actors?: string | null; // JSON array of actor user IDs
  action?: string | null; // moderation action (Removed etc.)
  reason?: string | null; // moderation reason
  created_at: number;
  updated_at: number;
  read: number; // 0 or 1
}

export interface PushSubscriptionRecord {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
  created_at: number;
}

export interface NotificationPreferences {
  Likes: boolean;
  Quotes: boolean;
  Chats: boolean;
  Replies: boolean;
  Mentions: boolean;
  Follows: boolean;
  FollowedPosts: boolean;
  ThreadActivity: boolean;
  InstallPromptSeen: boolean;
}
