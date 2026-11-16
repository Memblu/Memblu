import { db } from "./db.js";
import { UserRecord } from "./types.js";

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Photop Revival Admin CLI

Usage:
  npx tsx src/admin.ts list-users
  npx tsx src/admin.ts set-role <username> <RoleName>
  npx tsx src/admin.ts unban <username>
  npx tsx src/admin.ts reset-password <username> <newPassword>
  npx tsx src/admin.ts stats

Available Roles:
  Owner, Moderator, Developer, Contributor, Verified, Partner, Tester, User
`);
}

if (!command || command === "--help" || command === "help") {
  printHelp();
  process.exit(0);
}

switch (command) {
  case "list-users": {
    const users = db.prepare("SELECT id, user, email, role, status, creation_time FROM users ORDER BY creation_time ASC").all() as any[];
    console.log(`\nTotal Users: ${users.length}`);
    console.table(users.map(u => ({
      ID: u.id,
      Username: u.user,
      Email: u.email,
      Role: u.role,
      Status: u.status,
      Joined: new Date(u.creation_time).toLocaleString()
    })));
    break;
  }

  case "set-role": {
    const username = args[1];
    const role = args[2];
    if (!username || !role) {
      console.error("Error: Missing username or role. Example: npx tsx src/admin.ts set-role Alice Owner");
      process.exit(1);
    }

    const validRoles = ["Owner", "Moderator", "Developer", "Contributor", "Verified", "Partner", "Tester", "User"];
    if (!validRoles.includes(role)) {
      console.warn(`Warning: '${role}' is not one of the standard roles (${validRoles.join(", ")}).`);
    }

    const user = db.prepare("SELECT * FROM users WHERE user_lower = ?").get(username.toLowerCase()) as UserRecord | undefined;
    if (!user) {
      console.error(`Error: User '${username}' not found.`);
      process.exit(1);
    }

    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, user.id);
    console.log(`✔ Successfully updated role of '${user.user}' to '${role}'!`);
    break;
  }

  case "unban": {
    const username = args[1];
    if (!username) {
      console.error("Error: Missing username. Example: npx tsx src/admin.ts unban Alice");
      process.exit(1);
    }

    const user = db.prepare("SELECT * FROM users WHERE user_lower = ?").get(username.toLowerCase()) as UserRecord | undefined;
    if (!user) {
      console.error(`Error: User '${username}' not found.`);
      process.exit(1);
    }

    db.prepare("UPDATE users SET status = 'active', ban_data = NULL WHERE id = ?").run(user.id);
    console.log(`✔ Successfully unbanned '${user.user}'!`);
    break;
  }

  case "stats": {
    const userCount = (db.prepare("SELECT COUNT(*) as c FROM users").get() as any).c;
    const postCount = (db.prepare("SELECT COUNT(*) as c FROM posts WHERE deleted = 0").get() as any).c;
    const chatCount = (db.prepare("SELECT COUNT(*) as c FROM chats WHERE hidden = 0").get() as any).c;
    const likeCount = (db.prepare("SELECT COUNT(*) as c FROM likes").get() as any).c;
    const followCount = (db.prepare("SELECT COUNT(*) as c FROM follows").get() as any).c;

    console.log(`
Photop Revival Statistics:
  Total Users:    ${userCount}
  Total Posts:    ${postCount}
  Total Chats:    ${chatCount}
  Total Likes:    ${likeCount}
  Total Follows:  ${followCount}
`);
    break;
  }

  default: {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
}
