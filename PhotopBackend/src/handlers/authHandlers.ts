import { db } from "../db.js";
import { generateId, hashPassword, verifyPassword, createSession } from "../auth.js";
import { UserRecord } from "../types.js";

export function handleCreateConnection(): any {
  return { Code: 200, ServerVersion: 6.3 };
}

export function handleSignUpAccount(body: any, clientIp: string): any {
  const { Email, Username, Password } = body;

  if (!Username || !Password || !Email) {
    return { Code: 400, Message: "Missing required fields." };
  }

  const cleanUser = Username.trim();
  if (cleanUser.length < 3 || cleanUser.length > 16 || !/^[A-Za-z0-9_-]+$/.test(cleanUser)) {
    return { Code: 400, Message: "Invalid username." };
  }

  if (Password.length < 8) {
    return { Code: 400, Message: "Password must be at least 8 characters long." };
  }

  const userLower = cleanUser.toLowerCase();
  const existingUser = db.prepare("SELECT id FROM users WHERE user_lower = ? OR email = ?").get(userLower, Email.toLowerCase()) as { id: string } | undefined;
  if (existingUser) {
    return { Code: 409, Message: "Username or email is already in use." };
  }

  const userId = generateId();
  const passwordHash = hashPassword(Password);
  const now = Date.now();
  const defaultSettings = {
    ProfilePic: "DefaultProfilePic",
    Display: {
      "Embed Twitch Live Chat": true,
      "Embed Twitch Streams": true,
      "Embed YouTube Videos": true,
      "Embed GIFs": true,
      "Embed Scratch Games": false,
      "Embed code.org Projects": false,
      Theme: "Dark Mode"
    }
  };
  const defaultProfileData = {
    Bio: "",
    Socials: {},
    Followers: 0,
    Following: 0,
    PinnedPost: ""
  };

  db.prepare(`
    INSERT INTO users (id, user, user_lower, email, password_hash, role, creation_time, settings, profile_data, blocked_users, status)
    VALUES (?, ?, ?, ?, ?, 'User', ?, ?, ?, '[]', 'active')
  `).run(
    userId,
    cleanUser,
    userLower,
    Email.toLowerCase(),
    passwordHash,
    now,
    JSON.stringify(defaultSettings),
    JSON.stringify(defaultProfileData)
  );

  const session = createSession(userId, clientIp);

  return {
    Code: 200,
    RealUser: cleanUser,
    UserID: userId,
    CustomURL: null,
    Email: Email.toLowerCase(),
    Settings: defaultSettings,
    ProfileData: defaultProfileData,
    Role: "User",
    Token: session.token,
    TokenExpireDuration: session.expireDuration
  };
}

export function handleSignInAccount(body: any, clientIp: string): any {
  const { Username, Password } = body;
  if (!Username || !Password) {
    return { Code: 403, Message: "Missing username or password." };
  }

  const userLower = Username.trim().toLowerCase();
  const user = db.prepare(`
    SELECT * FROM users WHERE user_lower = ? OR email = ?
  `).get(userLower, userLower) as UserRecord | undefined;

  if (!user || !verifyPassword(Password, user.password_hash)) {
    return { Code: 403, Message: "Incorrect username or password." };
  }

  if (user.status === "disabled" || user.status === "pending_delete") {
    return {
      Code: 409,
      ModifiedType: user.status === "pending_delete" ? "Delete" : "Disabled",
      Timeframe: user.delete_timeframe || 604800
    };
  }

  const session = createSession(user.id, clientIp);
  const settings = JSON.parse(user.settings || "{}");
  const profileData = JSON.parse(user.profile_data || "{}");
  const blockedUsers = JSON.parse(user.blocked_users || "[]");

  // Banned accounts can still sign in so they can read the ban reason and
  // submit an appeal. The client shows a blocking ban notice for BanData and
  // does not start a normal session UI.
  const banData = user.status === "banned" ? banDataFor(user) : null;

  return {
    Code: 200,
    RealUser: user.user,
    UserID: user.id,
    CustomURL: user.custom_url || null,
    Email: user.email,
    Settings: settings,
    ProfileData: profileData,
    Role: user.role,
    BlockedUsers: blockedUsers,
    Token: session.token,
    TokenExpireDuration: session.expireDuration,
    BanData: banData
  };
}

function banDataFor(user: UserRecord): any {
  try {
    const parsed = JSON.parse(user.ban_data || "{}");
    if (parsed && parsed.BanReason) return parsed;
  } catch {
    // Fall through to the default notice below.
  }
  return {
    Account: user.user,
    BanReason: "Violating community guidelines.",
    BanExpires: "Permanent",
    Appealed: false
  };
}

export function handleGetAccountData(user: UserRecord | null): any {
  if (!user) {
    return { Code: 401, Message: "Not authenticated." };
  }

  // Reloading the page as a banned user should still surface the ban notice.
  const banData = user.status === "banned" ? banDataFor(user) : null;

  return {
    Code: 200,
    UserData: {
      _id: user.id,
      User: user.user,
      CustomURL: user.custom_url || null,
      Email: user.email,
      Role: user.role,
      Settings: JSON.parse(user.settings || "{}"),
      ProfileData: JSON.parse(user.profile_data || "{}"),
      BlockedUsers: JSON.parse(user.blocked_users || "[]")
    },
    BanData: banData
  };
}

export function handleLogoutAccount(token: string | undefined): any {
  if (token) {
    const cleanToken = token.replace("DO_NOT_SHARE_", "");
    db.prepare("DELETE FROM sessions WHERE token = ?").run(cleanToken);
  }
  return { Code: 200 };
}

export function handleUsernameAvailability(body: any): any {
  const username = body.Username ? body.Username.trim().toLowerCase() : "";
  if (!username) {
    return { Code: 200, Available: false };
  }
  const existing = db.prepare("SELECT id FROM users WHERE user_lower = ?").get(username);
  return { Code: 200, Available: !existing };
}
