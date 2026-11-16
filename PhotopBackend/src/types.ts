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
}

export interface ChatRecord {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  timestamp: number;
  reply_id?: string | null;
  hidden: number; // 0 or 1
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
