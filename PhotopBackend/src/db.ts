import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "photop.sqlite");
export const db = new DatabaseSync(dbPath);

// Enable WAL mode for high performance concurrency
db.exec("PRAGMA journal_mode = WAL;");
// Wait for short-lived locks from other connections (for example the admin
// test process or a second worker) instead of throwing "database is locked".
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA foreign_keys = ON;");

// Initialize tables
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL UNIQUE,
  user_lower TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'User',
  creation_time INTEGER NOT NULL,
  set_location TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  profile_data TEXT NOT NULL DEFAULT '{}',
  blocked_users TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  ban_data TEXT,
  delete_timeframe INTEGER
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  quotes INTEGER NOT NULL DEFAULT 0,
  chats INTEGER NOT NULL DEFAULT 0,
  media TEXT,
  configuration TEXT DEFAULT '[]',
  deleted INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_posts_timestamp ON posts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  reply_id TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_chats_post_time ON chats(post_id, timestamp ASC);

CREATE TABLE IF NOT EXISTS chat_likes (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_chat_likes_chat ON chat_likes(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_likes_user ON chat_likes(user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (follower_id, target_id),
  FOREIGN KEY (follower_id) REFERENCES users(id),
  FOREIGN KEY (target_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(target_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  last_visit INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS ban_appeals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  appeal TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT,
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  timestamp INTEGER NOT NULL,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  resolution_note TEXT,
  FOREIGN KEY (reporter_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_reports_content ON reports(content_type, content_id);

CREATE TABLE IF NOT EXISTS admin_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_log_time ON admin_log(timestamp DESC);
`);

// Existing databases were created before chat likes existed, so add the column
// (CREATE TABLE IF NOT EXISTS will not update an already-created table).
const chatColumns = db.prepare("PRAGMA table_info(chats)").all() as Array<{ name: string }>;
if (!chatColumns.some(c => c.name === "likes")) {
  db.exec("ALTER TABLE chats ADD COLUMN likes INTEGER NOT NULL DEFAULT 0;");
}

// Older ban_appeals tables only stored the appeal text. The admin panel tracks
// whether an appeal has been reviewed and who handled it.
const appealColumns = db.prepare("PRAGMA table_info(ban_appeals)").all() as Array<{ name: string }>;
const appealMigrations: Array<[string, string]> = [
  ["handled", "ALTER TABLE ban_appeals ADD COLUMN handled INTEGER NOT NULL DEFAULT 0;"],
  ["admin_note", "ALTER TABLE ban_appeals ADD COLUMN admin_note TEXT;"],
  ["reviewed_by", "ALTER TABLE ban_appeals ADD COLUMN reviewed_by TEXT;"],
  ["reviewed_at", "ALTER TABLE ban_appeals ADD COLUMN reviewed_at INTEGER;"]
];
for (const [column, sql] of appealMigrations) {
  if (!appealColumns.some(c => c.name === column)) {
    db.exec(sql);
  }
}
