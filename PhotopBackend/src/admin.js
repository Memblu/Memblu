"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var db_js_1 = require("./db.js");
var args = process.argv.slice(2);
var command = args[0];
function printHelp() {
    console.log("\nPhotop Revival Admin CLI\n\nUsage:\n  npx tsx src/admin.ts list-users\n  npx tsx src/admin.ts set-role <username> <RoleName>\n  npx tsx src/admin.ts unban <username>\n  npx tsx src/admin.ts reset-password <username> <newPassword>\n  npx tsx src/admin.ts stats\n\nAvailable Roles:\n  Owner, Moderator, Developer, Contributor, Verified, Partner, Tester, User\n");
}
if (!command || command === "--help" || command === "help") {
    printHelp();
    process.exit(0);
}
switch (command) {
    case "list-users": {
        var users = db_js_1.db.prepare("SELECT id, user, email, role, status, creation_time FROM users ORDER BY creation_time ASC").all();
        console.log("\nTotal Users: ".concat(users.length));
        console.table(users.map(function (u) { return ({
            ID: u.id,
            Username: u.user,
            Email: u.email,
            Role: u.role,
            Status: u.status,
            Joined: new Date(u.creation_time).toLocaleString()
        }); }));
        break;
    }
    case "set-role": {
        var username = args[1];
        var role = args[2];
        if (!username || !role) {
            console.error("Error: Missing username or role. Example: npx tsx src/admin.ts set-role Alice Owner");
            process.exit(1);
        }
        var validRoles = ["Owner", "Moderator", "Developer", "Contributor", "Verified", "Partner", "Tester", "User"];
        if (!validRoles.includes(role)) {
            console.warn("Warning: '".concat(role, "' is not one of the standard roles (").concat(validRoles.join(", "), ")."));
        }
        var user = db_js_1.db.prepare("SELECT * FROM users WHERE user_lower = ?").get(username.toLowerCase());
        if (!user) {
            console.error("Error: User '".concat(username, "' not found."));
            process.exit(1);
        }
        db_js_1.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, user.id);
        console.log("\u2714 Successfully updated role of '".concat(user.user, "' to '").concat(role, "'!"));
        break;
    }
    case "unban": {
        var username = args[1];
        if (!username) {
            console.error("Error: Missing username. Example: npx tsx src/admin.ts unban Alice");
            process.exit(1);
        }
        var user = db_js_1.db.prepare("SELECT * FROM users WHERE user_lower = ?").get(username.toLowerCase());
        if (!user) {
            console.error("Error: User '".concat(username, "' not found."));
            process.exit(1);
        }
        db_js_1.db.prepare("UPDATE users SET status = 'active', ban_data = NULL WHERE id = ?").run(user.id);
        console.log("\u2714 Successfully unbanned '".concat(user.user, "'!"));
        break;
    }
    case "stats": {
        var userCount = db_js_1.db.prepare("SELECT COUNT(*) as c FROM users").get().c;
        var postCount = db_js_1.db.prepare("SELECT COUNT(*) as c FROM posts WHERE deleted = 0").get().c;
        var chatCount = db_js_1.db.prepare("SELECT COUNT(*) as c FROM chats WHERE hidden = 0").get().c;
        var likeCount = db_js_1.db.prepare("SELECT COUNT(*) as c FROM likes").get().c;
        var followCount = db_js_1.db.prepare("SELECT COUNT(*) as c FROM follows").get().c;
        console.log("\nPhotop Revival Statistics:\n  Total Users:    ".concat(userCount, "\n  Total Posts:    ").concat(postCount, "\n  Total Chats:    ").concat(chatCount, "\n  Total Likes:    ").concat(likeCount, "\n  Total Follows:  ").concat(followCount, "\n"));
        break;
    }
    default: {
        console.error("Unknown command: ".concat(command));
        printHelp();
        process.exit(1);
    }
}
