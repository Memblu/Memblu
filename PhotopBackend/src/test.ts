import { WebSocket } from "ws";
import http from "node:http";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";

const BASE_URL = "http://127.0.0.1:3000";
const WS_URL = "ws://127.0.0.1:3000/Server1";

// Track everything the suite creates so it can remove its own test data.
const createdUserIDs: string[] = [];
const createdMediaFiles: string[] = [];

function cleanupTestData(): void {
  const ids = Array.from(new Set(createdUserIDs.filter(Boolean)));
  const removed: Record<string, number> = {};
  const marks = (list: string[]) => list.map(() => "?").join(",");

  if (ids.length > 0) {
    const ph = marks(ids);
    db.exec("BEGIN");
    try {
      const postIDs = db.prepare(`SELECT id FROM posts WHERE user_id IN (${ph})`)
        .all(...ids).map((row: any) => String(row.id));
      const chatSQL = `SELECT id FROM chats WHERE user_id IN (${ph})` +
        (postIDs.length > 0 ? ` OR post_id IN (${marks(postIDs)})` : "");
      const chatIDs = db.prepare(chatSQL)
        .all(...ids, ...postIDs).map((row: any) => String(row.id));

      const run = (table: string, sql: string, params: any[]) => {
        removed[table] = Number(db.prepare(sql).run(...params).changes || 0);
      };

      if (chatIDs.length > 0) {
        run("chat_likes", `DELETE FROM chat_likes WHERE user_id IN (${ph}) OR chat_id IN (${marks(chatIDs)})`, [...ids, ...chatIDs]);
      } else {
        run("chat_likes", `DELETE FROM chat_likes WHERE user_id IN (${ph})`, ids);
      }

      if (postIDs.length > 0) {
        run("likes", `DELETE FROM likes WHERE user_id IN (${ph}) OR post_id IN (${marks(postIDs)})`, [...ids, ...postIDs]);
      } else {
        run("likes", `DELETE FROM likes WHERE user_id IN (${ph})`, ids);
      }

      if (chatIDs.length > 0) {
        run("chats", `DELETE FROM chats WHERE id IN (${marks(chatIDs)})`, chatIDs);
      }
      if (postIDs.length > 0) {
        run("posts", `DELETE FROM posts WHERE id IN (${marks(postIDs)})`, postIDs);
      }

      run("follows", `DELETE FROM follows WHERE follower_id IN (${ph}) OR target_id IN (${ph})`, [...ids, ...ids]);
      run("sessions", `DELETE FROM sessions WHERE user_id IN (${ph})`, ids);
      run("ban_appeals", `DELETE FROM ban_appeals WHERE user_id IN (${ph})`, ids);

      const reportClauses = [`reporter_id IN (${ph})`];
      const reportParams: any[] = [...ids];
      if (postIDs.length > 0) {
        reportClauses.push(`(content_type = 'Post' AND content_id IN (${marks(postIDs)}))`);
        reportParams.push(...postIDs);
      }
      if (chatIDs.length > 0) {
        reportClauses.push(`(content_type = 'Chat' AND content_id IN (${marks(chatIDs)}))`);
        reportParams.push(...chatIDs);
      }
      reportClauses.push(`(content_type = 'User' AND content_id IN (${ph}))`);
      reportParams.push(...ids);
      run("reports", `DELETE FROM reports WHERE ${reportClauses.join(" OR ")}`, reportParams);

      run("push_subscriptions", `DELETE FROM push_subscriptions WHERE user_id IN (${ph})`, ids);
      run("notifications", `DELETE FROM notifications WHERE recipient_id IN (${ph}) OR actor_id IN (${ph})`, [...ids, ...ids]);
      run("admin_log", `DELETE FROM admin_log WHERE actor_id IN (${ph})`, ids);
      run("users", `DELETE FROM users WHERE id IN (${ph})`, ids);

      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  for (const fileName of createdMediaFiles) {
    try {
      fs.rmSync(path.join(process.cwd(), "media", "PostImages", fileName), { force: true });
    } catch {
      // Media cleanup is best-effort; the database rows are what matter.
    }
  }

  if (ids.length === 0) {
    console.log("🧹 No test data to clean up.");
    return;
  }
  const summary = Object.entries(removed)
    .filter(([, count]) => count > 0)
    .map(([table, count]) => `${table}: ${count}`)
    .join(", ");
  console.log(`🧹 Removed ${ids.length} test accounts${summary ? ` (${summary})` : ""}.`);
}

async function runTests() {
  console.log("Starting backend tests...");

  // 1. Connect to WebSocket
  const ws = new WebSocket(WS_URL);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", (err) => reject(err));
  });
  console.log("✔ Connected to WebSocket /Server1");

  let reqId = 0;
  const awaiting = new Map<number, (body: any) => void>();
  let broadcastHandler: ((body: any) => void) | null = null;

  ws.on("message", (raw) => {
    const data = JSON.parse(raw.toString());
    if (data.Metadata?.ReqSource === "Client") {
      const id = data.Metadata.SentMetadata?.ReqID;
      if (id !== undefined && awaiting.has(id)) {
        awaiting.get(id)!(data.Body);
        awaiting.delete(id);
      }
    } else if (broadcastHandler != null) {
      broadcastHandler(data.Body);
    }
  });

  function waitForBroadcast(predicate: (body: any) => boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        broadcastHandler = null;
        reject(new Error("Timed out waiting for server broadcast"));
      }, 2000);
      broadcastHandler = (body) => {
        if (predicate(body)) {
          clearTimeout(timer);
          broadcastHandler = null;
          resolve(body);
        }
      };
    });
  }

  function sendReq(task: string, payload: any, token?: string, userId?: string): Promise<any> {
    const currentId = reqId++;
    const packet = {
      Metadata: {
        ReqID: currentId,
        ReqTask: task,
        AuthToken: token,
        UserID: userId
      },
      Body: payload
    };
    return new Promise((resolve) => {
      awaiting.set(currentId, resolve);
      ws.send(JSON.stringify(packet));
    });
  }

  // 2. Test CreateConnection
  const connRes = await sendReq("CreateConnection", {});
  assert.strictEqual(connRes.Code, 200, "CreateConnection should return 200");
  assert.strictEqual(connRes.ServerVersion, 6.3, "ServerVersion should be 6.3");
  console.log("✔ CreateConnection verified");

  // 3. Test SignUpAccount
  const testUser = "testuser_" + Math.floor(Math.random() * 10000);
  const signUpRes = await sendReq("SignUpAccount", {
    Username: testUser,
    Email: `${testUser}@example.com`,
    Password: "Password123!"
  });
  assert.strictEqual(signUpRes.Code, 200, "SignUpAccount should return 200");
  assert.strictEqual(signUpRes.RealUser, testUser, "RealUser should match");
  assert.ok(signUpRes.Token, "Token should be present");
  assert.ok(signUpRes.UserID, "UserID should be present");
  assert.strictEqual(signUpRes.Settings.ProfilePic, "DefaultProfilePic", "New users should get the default profile image");
  const token = signUpRes.Token;
  const userId = signUpRes.UserID;
  createdUserIDs.push(userId);
  console.log(`✔ SignUpAccount verified for ${testUser} (${userId})`);

  // 4. Test GetAccountData
  const accRes = await sendReq("GetAccountData", {}, token, userId);
  assert.strictEqual(accRes.Code, 200, "GetAccountData should return 200");
  assert.strictEqual(accRes.UserData.User, testUser, "UserData.User should match");
  console.log("✔ GetAccountData verified");

  // 5. Test CreatePost
  const postRes = await sendReq("CreatePost", {
    Text: "Hello world! Photop is revived!",
    Media: {},
    Configuration: []
  }, token, userId);
  assert.strictEqual(postRes.Code, 200, "CreatePost should return 200");
  assert.ok(postRes.NewPostID, "NewPostID should be returned");
  const postId = postRes.NewPostID;
  console.log(`✔ CreatePost verified (PostID: ${postId})`);

  // 6. Test GetPosts
  const feedRes = await sendReq("GetPosts", { Amount: 15 }, token, userId);
  assert.strictEqual(feedRes.Code, 200, "GetPosts should return 200");
  assert.ok(feedRes.Posts.length > 0, "Feed should contain at least 1 post");
  const foundPost = feedRes.Posts.find((p: any) => p._id === postId);
  assert.ok(foundPost, "Feed should contain the newly created post");
  assert.strictEqual(foundPost.Text, "Hello world! Photop is revived!");
  console.log("✔ GetPosts verified");

  // 7. Test LikePost
  const likeRes = await sendReq("LikePost", { PostID: postId }, token, userId);
  assert.strictEqual(likeRes.Code, 200, "LikePost should return 200");
  const feedAfterLike = await sendReq("GetPosts", { LookupID: postId }, token, userId);
  assert.strictEqual(feedAfterLike.Posts[0].Likes, 1, "Likes count should be incremented to 1");
  assert.strictEqual(feedAfterLike.Likes.length, 1, "Likes array should contain current user like");
  console.log("✔ LikePost verified");

  // 8. Test ConnectLiveChat and CreateChat
  const chatConnRes = await sendReq("ConnectLiveChat", { Posts: [postId], Amount: 25 }, token, userId);
  assert.strictEqual(chatConnRes.Code, 200, "ConnectLiveChat should return 200");

  const createChatRes = await sendReq("CreateChat", {
    PostID: postId,
    Text: "Testing live chat on this post!"
  }, token, userId);
  assert.strictEqual(createChatRes.Code, 200, "CreateChat should return 200");

  const getChatsRes = await sendReq("GetChats", { Post: postId, Amount: 15 }, token, userId);
  assert.strictEqual(getChatsRes.Code, 200, "GetChats should return 200");
  assert.ok(getChatsRes.Chats.length > 0, "Chats should be retrieved");
  assert.strictEqual(getChatsRes.Chats[0].Text, "Testing live chat on this post!");

  // 8b. Test replying to a chat. The client renders replies using
  // ReplyData.UserData.User, so the backend must include the parent author.
  const parentChatID = getChatsRes.Chats[0]._id;
  const replyChatRes = await sendReq("CreateChat", {
    PostID: postId,
    Text: "Replying to my own chat!",
    ReplyID: parentChatID
  }, token, userId);
  assert.strictEqual(replyChatRes.Code, 200, "CreateChat reply should return 200");

  const getRepliesRes = await sendReq("GetChats", { Post: postId, Amount: 15 }, token, userId);
  const replyChat = getRepliesRes.Chats.find((c: any) => c.ReplyID === parentChatID);
  assert.ok(replyChat, "Reply chat should reference the parent chat");
  const parentReply = getRepliesRes.Replies.find((r: any) => r._id === parentChatID);
  assert.ok(parentReply, "Reply payload should include the parent chat");
  assert.strictEqual(parentReply.UserData.User, testUser, "Reply payload should include the parent author's UserData");
  console.log("✔ Chat replies verified");

  // 8c. Test chat likes (count, per-user IsLiked, and idempotency).
  const likeChatRes = await sendReq("LikeChat", { ChatID: parentChatID }, token, userId);
  assert.strictEqual(likeChatRes.Code, 200, "LikeChat should return 200");
  assert.strictEqual(likeChatRes.Likes, 1, "Chat likes should increment to 1");
  assert.strictEqual(likeChatRes.IsLiked, true, "LikeChat should report IsLiked");

  const chatsAfterChatLike = await sendReq("GetChats", { Post: postId, Amount: 15 }, token, userId);
  const likedChat = chatsAfterChatLike.Chats.find((c: any) => c._id === parentChatID);
  assert.ok(likedChat, "Liked chat should still be returned");
  assert.strictEqual(likedChat.Likes, 1, "Chat response should include the like count");
  assert.strictEqual(likedChat.IsLiked, true, "Chat response should include the viewer's IsLiked state");

  const likeChatAgainRes = await sendReq("LikeChat", { ChatID: parentChatID }, token, userId);
  assert.strictEqual(likeChatAgainRes.Likes, 1, "Liking the same chat twice should not double-count");

  const unlikeChatRes = await sendReq("UnlikeChat", { ChatID: parentChatID }, token, userId);
  assert.strictEqual(unlikeChatRes.Code, 200, "UnlikeChat should return 200");
  assert.strictEqual(unlikeChatRes.Likes, 0, "Chat likes should decrement to 0");
  assert.strictEqual(unlikeChatRes.IsLiked, false, "UnlikeChat should report IsLiked false");

  const chatsAfterChatUnlike = await sendReq("GetChats", { Post: postId, Amount: 15 }, token, userId);
  const unlikedChat = chatsAfterChatUnlike.Chats.find((c: any) => c._id === parentChatID);
  assert.strictEqual(unlikedChat.Likes, 0, "Chat response should reflect the removed like");
  assert.strictEqual(unlikedChat.IsLiked, false, "Chat response should reflect the viewer's unliked state");
  console.log("✔ Chat likes verified");

  // 8d. Test post/chat embeds. Quoting with "/Post_<id>" or "/Chat_<id>" relies
  // on LoadPlatformEmbeds returning the referenced content and its authors.
  const embedRes = await sendReq("LoadPlatformEmbeds", {
    Embeds: [
      { AssetType: "Post", AssetID: postId },
      { AssetType: "Chat", AssetID: parentChatID },
      { AssetType: "Chat", AssetID: replyChat._id },
      { AssetType: "Post", AssetID: "missingpost" }
    ]
  }, token, userId);
  assert.strictEqual(embedRes.Code, 200, "LoadPlatformEmbeds should return 200");

  const embeddedPost = embedRes.EmbedData["Post" + postId];
  assert.ok(embeddedPost, "Post embed data should be returned");
  assert.strictEqual(embeddedPost.Text, "Hello world! Photop is revived!");
  assert.strictEqual(embeddedPost.UserID, userId);
  assert.strictEqual(embedRes.UserData[userId].User, testUser, "Post embed should include author data");

  const embeddedChat = embedRes.EmbedData["Chat" + parentChatID];
  assert.ok(embeddedChat, "Chat embed data should be returned");
  assert.strictEqual(embeddedChat.Text, "Testing live chat on this post!");
  assert.strictEqual(embedRes.UserData[embeddedChat.UserID].User, testUser, "Chat embed should include author data");

  const embeddedReply = embedRes.EmbedData["Chat" + replyChat._id];
  assert.ok(embeddedReply, "Reply chat embed data should be returned");
  assert.strictEqual(embeddedReply.ReplyID, parentChatID, "Reply embed should expose the parent chat");
  assert.ok(embedRes.EmbedData["Chat" + parentChatID], "Reply embed should include the parent chat data");

  assert.strictEqual(embedRes.EmbedData["Postmissingpost"], undefined, "Missing posts should not produce embed data");
  console.log("✔ Post and chat embeds verified");

  // 8e. Test deleting an own chat. Authors (including plain "User" accounts)
  // must be able to remove their own messages, not just moderators.
  const deleteChatRes = await sendReq("UpdateChat", { ChatID: replyChat._id, UpdateValues: [["Hidden", ""]] }, token, userId);
  assert.strictEqual(deleteChatRes.Code, 200, "Authors should be able to delete their own chat");
  const chatsAfterChatDelete = await sendReq("GetChats", { Post: postId, Amount: 15 }, token, userId);
  assert.ok(!chatsAfterChatDelete.Chats.some((c: any) => c._id === replyChat._id), "Deleted chat should no longer be returned");
  console.log("✔ Chat deletion by author verified");

  // 9. Test GetProfile
  const profileRes = await sendReq("GetProfile", { ProfileUserID: userId }, token, userId);
  assert.strictEqual(profileRes.Code, 200, "GetProfile should return 200");
  assert.strictEqual(profileRes.UserInfo.User, testUser);
  console.log("✔ GetProfile verified");

  // 10. Test Image Upload HTTP Endpoint
  const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
  const requestDataJson = JSON.stringify({
    Type: "PostImageUpload",
    AccountData: {
      UserID: userId,
      AuthToken: token,
      Fingerprint: "12345"
    },
    Metadata: {
      PostID: postId
    }
  });

  const dummyImageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

  const multipartBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="RequestData"\r\n\r\n${requestDataJson}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="File0"; filename="image0.png"\r\nContent-Type: image/png\r\n\r\n`),
    dummyImageBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const uploadReq = http.request(`${BASE_URL}/ImageUpload`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": multipartBody.length
    }
  });

  const uploadRes = await new Promise<any>((resolve, reject) => {
    uploadReq.on("response", (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(body || "{}") }));
    });
    uploadReq.on("error", reject);
    uploadReq.write(multipartBody);
    uploadReq.end();
  });

  assert.strictEqual(uploadRes.status, 200, "ImageUpload HTTP status should be 200");
  assert.strictEqual(uploadRes.data.success, true, "ImageUpload response should indicate success");
  createdMediaFiles.push(`${postId}0`);
  console.log("✔ HTTP ImageUpload endpoint verified");

  // 11. Test Static Media File Serving
  const mediaReq = http.request(`${BASE_URL}/PostImages/${postId}0`, { method: "GET" });
  const mediaRes = await new Promise<any>((resolve, reject) => {
    mediaReq.on("response", (res) => {
      resolve(res.statusCode);
    });
    mediaReq.on("error", reject);
    mediaReq.end();
  });
  assert.strictEqual(mediaRes, 200, "Static image serving should return 200");
  console.log(`✔ Static media serving /PostImages/${postId}0 verified`);

  // 12. Test Default Profile Image
  const defaultPicReq = http.request(`${BASE_URL}/ProfileImages/DefaultProfilePic`, { method: "GET" });
  const defaultPicRes = await new Promise<any>((resolve, reject) => {
    defaultPicReq.on("response", (res) => {
      resolve({ status: res.statusCode, contentType: res.headers["content-type"] });
      res.resume();
    });
    defaultPicReq.on("error", reject);
    defaultPicReq.end();
  });
  assert.strictEqual(defaultPicRes.status, 200, "Default profile image should be served");
  assert.ok(String(defaultPicRes.contentType).startsWith("image/"), "Default profile image should be served with an image content type");
  console.log("✔ Default profile image serving verified");

  // 13. Test real-time post deletion. Deleting a post must broadcast a
  // NewPostDeleted packet so connected clients can remove the post in place,
  // and subsequent lookups must no longer return it.
  const deleteBroadcast = waitForBroadcast(
    (body) => body.ClientFunction === "NewPostDeleted" && Array.isArray(body.PostIDs) && body.PostIDs.includes(postId)
  );
  const deletePostRes = await sendReq("UpdatePost", { Task: "Delete", PostID: postId }, token, userId);
  assert.strictEqual(deletePostRes.Code, 200, "Authors should be able to delete their own post");
  const deletePacket = await deleteBroadcast;
  assert.deepStrictEqual(deletePacket.PostIDs, [postId], "Delete broadcast should identify the removed post");
  const postAfterDelete = await sendReq("GetPosts", { LookupID: postId }, token, userId);
  assert.strictEqual(postAfterDelete.Posts.length, 0, "Deleted post should no longer be returned");
  console.log("✔ Real-time post deletion broadcast verified");

  // 14. Test admin panel access control. Only staff (Owner/Moderator) may use
  // the panel, and management actions are Owner-only.
  async function signUpUser(prefix: string) {
    const name = prefix + "_" + Math.floor(Math.random() * 10000);
    const res = await sendReq("SignUpAccount", {
      Username: name,
      Email: `${name}@example.com`,
      Password: "Password123!"
    });
    assert.strictEqual(res.Code, 200, `${prefix} signup should succeed`);
    createdUserIDs.push(res.UserID as string);
    return { name, token: res.Token as string, id: res.UserID as string };
  }

  const owner = await signUpUser("aown");
  db.prepare("UPDATE users SET role = 'Owner' WHERE id = ?").run(owner.id);
  const moderator = await signUpUser("amod");
  db.prepare("UPDATE users SET role = 'Moderator' WHERE id = ?").run(moderator.id);
  const target = await signUpUser("atgt");

  const plainDenied = await sendReq("AdminOverview", {}, token, userId);
  assert.strictEqual(plainDenied.Code, 403, "Plain users must not access the admin panel");
  const anonymousDenied = await sendReq("AdminOverview", {});
  assert.strictEqual(anonymousDenied.Code, 401, "Anonymous requests must not access the admin panel");
  console.log("✔ Admin access control verified");

  // 14b. Test post editing: only the author may change the text, the change is
  // persisted, and every client is told about it in real time.
  const editPostRes = await sendReq("CreatePost", {
    Text: "Original text before editing",
    Media: {},
    Configuration: []
  }, token, userId);
  assert.strictEqual(editPostRes.Code, 200, "Edit test post should be created");
  const editPostId = editPostRes.NewPostID;

  const editBroadcast = waitForBroadcast(
    (body) => body.ClientFunction === "PostUpdated" && body.PostID === editPostId
  );
  const editRes = await sendReq("UpdatePost", {
    Task: "Edit", PostID: editPostId, Text: "Edited text that every client receives"
  }, token, userId);
  assert.strictEqual(editRes.Code, 200, "Authors should be able to edit their own post");
  assert.strictEqual(editRes.Text, "Edited text that every client receives");
  assert.ok(editRes.EditedAt > 0, "Edits should record an edited timestamp");

  const editPacket = await editBroadcast;
  assert.strictEqual(editPacket.Text, "Edited text that every client receives", "Edit broadcast should carry the new text");
  assert.strictEqual(editPacket.EditedAt, editRes.EditedAt, "Edit broadcast should carry the edited timestamp");
  const editedLookup = await sendReq("GetPosts", { LookupID: editPostId }, token, userId);
  assert.strictEqual(editedLookup.Posts[0].Text, "Edited text that every client receives", "Edited text should persist");
  assert.strictEqual(editedLookup.Posts[0].EditedAt, editRes.EditedAt, "Edited timestamp should persist and be returned");

  const foreignEdit = await sendReq("UpdatePost", {
    Task: "Edit", PostID: editPostId, Text: "Someone else's words"
  }, target.token, target.id);
  assert.strictEqual(foreignEdit.Code, 403, "Non-authors must not edit a post");

  const tooLongEdit = await sendReq("UpdatePost", {
    Task: "Edit", PostID: editPostId, Text: "x".repeat(401)
  }, token, userId);
  assert.strictEqual(tooLongEdit.Code, 400, "Edits over 400 characters should be rejected");

  const emptyEdit = await sendReq("UpdatePost", {
    Task: "Edit", PostID: editPostId, Text: "   "
  }, token, userId);
  assert.strictEqual(emptyEdit.Code, 400, "Text-only posts must keep some text");

  const deletedEdit = await sendReq("UpdatePost", {
    Task: "Edit", PostID: postId, Text: "Editing something gone"
  }, token, userId);
  assert.strictEqual(deletedEdit.Code, 404, "Deleted posts must not be editable");
  console.log("✔ Post editing verified");

  // 14c. Test chat editing: the author can change a chat, the timestamp is
  // recorded, and every client receives the updated text live.
  const editChatBroadcast = waitForBroadcast(
    (body) => body.ClientFunction === "ChatUpdated" && body.ChatID === parentChatID
  );
  const editChatRes = await sendReq("UpdateChat", {
    Task: "Edit", ChatID: parentChatID, Text: "Edited chat text for everyone"
  }, token, userId);
  assert.strictEqual(editChatRes.Code, 200, "Authors should be able to edit their own chat");
  assert.strictEqual(editChatRes.Text, "Edited chat text for everyone");
  assert.ok(editChatRes.EditedAt > 0, "Chat edits should record a timestamp");

  const editedChatPacket = await editChatBroadcast;
  assert.strictEqual(editedChatPacket.Text, "Edited chat text for everyone", "Chat update broadcast should carry the new text");
  assert.strictEqual(editedChatPacket.EditedAt, editChatRes.EditedAt, "Chat update broadcast should carry the timestamp");

  const chatsAfterEdit = await sendReq("GetChats", { Post: postId, Amount: 25 }, token, userId);
  const editedChat = chatsAfterEdit.Chats.find((c: any) => c._id === parentChatID);
  assert.strictEqual(editedChat.Text, "Edited chat text for everyone", "Edited chat text should persist");
  assert.strictEqual(editedChat.EditedAt, editChatRes.EditedAt, "Edited chat timestamp should be returned");

  const foreignChatEdit = await sendReq("UpdateChat", {
    Task: "Edit", ChatID: parentChatID, Text: "Someone else's words"
  }, target.token, target.id);
  assert.strictEqual(foreignChatEdit.Code, 403, "Non-authors must not edit a chat");

  const longChatEdit = await sendReq("UpdateChat", {
    Task: "Edit", ChatID: parentChatID, Text: "x".repeat(201)
  }, token, userId);
  assert.strictEqual(longChatEdit.Code, 400, "Chat edits over 200 characters should be rejected");

  const emptyChatEdit = await sendReq("UpdateChat", {
    Task: "Edit", ChatID: parentChatID, Text: "   "
  }, token, userId);
  assert.strictEqual(emptyChatEdit.Code, 400, "Chat edits cannot be empty");
  console.log("✔ Chat editing verified");

  // 15. Test the overview payload (stats, 7 day activity, system info).
  const overviewRes = await sendReq("AdminOverview", {}, owner.token, owner.id);
  assert.strictEqual(overviewRes.Code, 200, "AdminOverview should return 200");
  assert.ok(overviewRes.Stats.Users >= 4, "Overview should count users");
  assert.strictEqual(overviewRes.Activity.length, 7, "Overview should return a 7 day activity series");
  assert.ok(overviewRes.Activity[0].Date && "Posts" in overviewRes.Activity[0], "Activity entries should be dated");
  assert.ok(overviewRes.System.Node, "Overview should include system info");
  assert.ok(overviewRes.ConnectedClients >= 1, "Overview should report connected clients");
  console.log("✔ AdminOverview verified");

  // 16. Test the user browser (pagination, search, filters) and user detail.
  const usersRes = await sendReq("AdminUsers", { Page: 1, Limit: 5 }, owner.token, owner.id);
  assert.strictEqual(usersRes.Code, 200, "AdminUsers should return 200");
  assert.ok(usersRes.Users.length > 0, "AdminUsers should return users");
  assert.ok(usersRes.Users.length <= 5, "AdminUsers should honour the page limit");
  assert.ok(usersRes.Total >= 4, "AdminUsers should report the total user count");

  const searchUsersRes = await sendReq("AdminUsers", { Search: target.name }, owner.token, owner.id);
  assert.strictEqual(searchUsersRes.Total, 1, "User search should find exactly the target user");
  assert.strictEqual(searchUsersRes.Users[0]._id, target.id);

  const staffRes = await sendReq("AdminUsers", { Filter: "Staff", Limit: 100 }, owner.token, owner.id);
  assert.ok(staffRes.Users.every((u: any) => u.Role === "Owner" || u.Role === "Moderator"), "Staff filter should only return staff");
  assert.ok(staffRes.Users.some((u: any) => u._id === owner.id), "Staff filter should include the owner");

  const detailRes = await sendReq("AdminUserDetail", { UserID: target.id }, owner.token, owner.id);
  assert.strictEqual(detailRes.Code, 200, "AdminUserDetail should return 200");
  assert.strictEqual(detailRes.User._id, target.id);
  assert.strictEqual(detailRes.User.Email, `${target.name}@example.com`);
  assert.ok(detailRes.Stats, "AdminUserDetail should include per-user stats");
  console.log("✔ Admin user browsing verified");

  // 17. Test role management (Owner-only).
  const moderatorRoleChange = await sendReq("AdminUpdateUser", {
    Task: "Role", UserID: target.id, Role: "Tester"
  }, moderator.token, moderator.id);
  assert.strictEqual(moderatorRoleChange.Code, 403, "Moderators must not be able to change roles");

  const roleChangeRes = await sendReq("AdminUpdateUser", {
    Task: "Role", UserID: target.id, Role: "Tester"
  }, owner.token, owner.id);
  assert.strictEqual(roleChangeRes.Code, 200, "Owners should be able to change roles");
  assert.strictEqual(roleChangeRes.Role, "Tester");
  const promotedDetail = await sendReq("AdminUserDetail", { UserID: target.id }, owner.token, owner.id);
  assert.strictEqual(promotedDetail.User.Role, "Tester", "Role change should persist");

  const invalidRoleRes = await sendReq("AdminUpdateUser", {
    Task: "Role", UserID: target.id, Role: "SuperAdmin"
  }, owner.token, owner.id);
  assert.strictEqual(invalidRoleRes.Code, 400, "Unknown roles must be rejected");

  await sendReq("AdminUpdateUser", { Task: "Role", UserID: target.id, Role: "User" }, owner.token, owner.id);
  console.log("✔ Admin role management verified");

  // 18. Test banning and unbanning, including the real-time ban packet.
  // Ban packets are only delivered to sockets signed in as the target, so open
  // a dedicated connection for that user instead of reusing the admin socket.
  const targetSocket = new WebSocket(WS_URL);
  await new Promise<void>((resolve, reject) => {
    targetSocket.on("open", () => resolve());
    targetSocket.on("error", (err) => reject(err));
  });
  const banBroadcast = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for the ban packet")), 3000);
    targetSocket.on("message", (raw) => {
      const data = JSON.parse(raw.toString());
      if (data.Metadata?.ReqSource === "Server" && data.Body?.ClientFunction === "UserBanDisplay") {
        clearTimeout(timer);
        resolve(data.Body);
      }
    });
  });
  targetSocket.send(JSON.stringify({
    Metadata: { ReqID: 999001, ReqTask: "GetAccountData", AuthToken: target.token, UserID: target.id },
    Body: {}
  }));
  await new Promise((resolve) => setTimeout(resolve, 250));

  const banRes = await sendReq("AdminUpdateUser", {
    Task: "Ban", UserID: target.id, Reason: "Admin panel test ban", BanLength: 3600
  }, owner.token, owner.id);
  assert.strictEqual(banRes.Code, 200, "Owners should be able to ban users");
  assert.strictEqual(banRes.BanTarget.UserID, target.id);
  // Admin responses must not put the target in the top-level UserID field:
  // clients treat that as the signed-in account and would drop the actor's
  // session after the action.
  assert.strictEqual(banRes.TargetUserID, target.id);
  assert.strictEqual(banRes.UserID, undefined, "Admin responses must not echo a session UserID");
  assert.strictEqual(banRes.BanTarget.BanData.BanReason, "Admin panel test ban");
  assert.strictEqual(banRes.RevokeSessionsFor, target.id, "Banning should revoke the target's sessions");
  const banPacket = await banBroadcast;
  assert.strictEqual(banPacket.Account, target.name, "Ban broadcast should identify the target");
  targetSocket.close();

  const bannedDetail = await sendReq("AdminUserDetail", { UserID: target.id }, owner.token, owner.id);
  assert.strictEqual(bannedDetail.User.Status, "banned", "User should be marked as banned");

  // Banned users must still be able to sign in so they can see the ban notice
  // and submit an appeal.
  const bannedSignIn = await sendReq("SignInAccount", {
    Username: target.name, Password: "Password123!"
  });
  assert.strictEqual(bannedSignIn.Code, 200, "Banned users should be able to sign in");
  assert.ok(bannedSignIn.BanData, "Sign-in should return the ban notice data");
  assert.strictEqual(bannedSignIn.BanData.BanReason, "Admin panel test ban");
  const bannedAccountData = await sendReq("GetAccountData", {}, target.token, target.id);
  assert.ok(bannedAccountData.BanData, "Reloading a banned account should still return the ban notice");

  const moderatorUnban = await sendReq("AdminUpdateUser", {
    Task: "Unban", UserID: target.id
  }, moderator.token, moderator.id);
  assert.strictEqual(moderatorUnban.Code, 403, "Moderators must not be able to unban users");

  const unbanRes = await sendReq("AdminUpdateUser", {
    Task: "Unban", UserID: target.id
  }, owner.token, owner.id);
  assert.strictEqual(unbanRes.Code, 200, "Owners should be able to unban users");
  const unbannedDetail = await sendReq("AdminUserDetail", { UserID: target.id }, owner.token, owner.id);
  assert.strictEqual(unbannedDetail.User.Status, "active", "User should be active after unban");
  console.log("✔ Admin ban and unban verified");

  // 19. Test content moderation: delete and restore a post.
  const targetPost = await sendReq("CreatePost", {
    Text: "Admin panel moderation test post",
    Media: {},
    Configuration: []
  }, target.token, target.id);
  assert.strictEqual(targetPost.Code, 200);
  const moderatedPostID = targetPost.NewPostID as string;

  const contentList = await sendReq("AdminContent", { Type: "Posts", Search: "Admin panel moderation test post" }, owner.token, owner.id);
  assert.strictEqual(contentList.Code, 200, "AdminContent should return 200");
  const listedPost = contentList.Items.find((item: any) => item._id === moderatedPostID);
  assert.ok(listedPost, "AdminContent should find the target post");
  assert.strictEqual(listedPost.Author, target.name, "Content rows should expose the author");

  const contentDeleteBroadcast = waitForBroadcast(
    (body) => body.ClientFunction === "NewPostDeleted" && Array.isArray(body.PostIDs) && body.PostIDs.includes(moderatedPostID)
  );
  const contentDeleteRes = await sendReq("AdminContentAction", {
    Task: "Delete", Type: "Post", ID: moderatedPostID
  }, owner.token, owner.id);
  assert.strictEqual(contentDeleteRes.Code, 200, "Admins should be able to delete content");
  assert.deepStrictEqual(contentDeleteRes.DeletedPostIDs, [moderatedPostID]);
  await contentDeleteBroadcast;

  const hiddenPostLookup = await sendReq("GetPosts", { LookupID: moderatedPostID }, owner.token, owner.id);
  assert.strictEqual(hiddenPostLookup.Posts.length, 0, "Deleted content should disappear from lookups");
  const deletedContent = await sendReq("AdminContent", { Type: "Posts", Search: moderatedPostID, Filter: "Deleted" }, owner.token, owner.id);
  assert.ok(deletedContent.Items.some((item: any) => item._id === moderatedPostID && item.Removed === true), "Deleted content should be listed as removed");

  const restoreRes = await sendReq("AdminContentAction", {
    Task: "Restore", Type: "Post", ID: moderatedPostID
  }, owner.token, owner.id);
  assert.strictEqual(restoreRes.Code, 200, "Admins should be able to restore content");
  const restoredPostLookup = await sendReq("GetPosts", { LookupID: moderatedPostID }, owner.token, owner.id);
  assert.strictEqual(restoredPostLookup.Posts.length, 1, "Restored content should be visible again");
  console.log("✔ Admin content moderation verified");

  // 20. Test the report queue and resolving a report.
  const reportRes = await sendReq("PostWebhook", {
    Webhook: "Report",
    Details: { Type: "Post", ReportContentID: moderatedPostID, Reason: "Spam" }
  }, token, userId);
  assert.strictEqual(reportRes.Code, 200, "Reporting content should succeed");

  const openReports = await sendReq("AdminReports", { Task: "List", Status: "open", Type: "Post" }, owner.token, owner.id);
  assert.strictEqual(openReports.Code, 200, "AdminReports should return 200");
  const targetReport = openReports.Reports.find((report: any) => report.ContentID === moderatedPostID);
  assert.ok(targetReport, "The new report should be queued");
  assert.strictEqual(targetReport.Reason, "Spam");
  assert.strictEqual(targetReport.Reporter, testUser, "Reports should include the reporter's username");

  const reportUpdateRes = await sendReq("AdminReports", {
    Task: "Update", ReportID: targetReport._id, Status: "dismissed", Note: "No action needed"
  }, moderator.token, moderator.id);
  assert.strictEqual(reportUpdateRes.Code, 200, "Moderators should be able to resolve reports");

  const dismissedReports = await sendReq("AdminReports", { Task: "List", Status: "dismissed", Type: "Post" }, owner.token, owner.id);
  assert.ok(dismissedReports.Reports.some((report: any) => report._id === targetReport._id), "Dismissed reports should move out of the open queue");

  const reportDeleteRes = await sendReq("AdminReports", {
    Task: "DeleteContent", ReportID: targetReport._id
  }, moderator.token, moderator.id);
  assert.strictEqual(reportDeleteRes.Code, 200, "Report actions should be able to remove content");
  assert.deepStrictEqual(reportDeleteRes.DeletedPostIDs, [moderatedPostID], "Removing a reported post should report the deletion");
  assert.strictEqual(reportDeleteRes.Status, "resolved");
  console.log("✔ Admin reports verified");

  // 21. Test ban appeals (listing, dismissing and reopening).
  await sendReq("AdminUpdateUser", {
    Task: "Ban", UserID: target.id, Reason: "Appeal test ban"
  }, owner.token, owner.id);
  const appealSendRes = await sendReq("SendBanAppeal", { Appeal: "Please review this ban." }, target.token, target.id);
  assert.strictEqual(appealSendRes.Code, 200, "Banned users should be able to appeal");

  const pendingAppeals = await sendReq("AdminAppeals", { Task: "List", Status: "pending" }, moderator.token, moderator.id);
  assert.strictEqual(pendingAppeals.Code, 200, "AdminAppeals should return 200");
  const targetAppeal = pendingAppeals.Appeals.find((appeal: any) => appeal.UserID === target.id);
  assert.ok(targetAppeal, "The new appeal should be queued");
  assert.strictEqual(targetAppeal.User, target.name);

  const dismissAppealRes = await sendReq("AdminAppeals", {
    Task: "Resolve", AppealID: targetAppeal._id, Action: "Dismiss", Note: "Ban stands"
  }, moderator.token, moderator.id);
  assert.strictEqual(dismissAppealRes.Code, 200, "Moderators should be able to dismiss appeals");
  assert.strictEqual(dismissAppealRes.Handled, true);

  const handledAppeals = await sendReq("AdminAppeals", { Task: "List", Status: "handled" }, owner.token, owner.id);
  assert.ok(handledAppeals.Appeals.some((appeal: any) => appeal._id === targetAppeal._id), "Handled appeals should leave the pending queue");

  const reopenAppealRes = await sendReq("AdminAppeals", {
    Task: "Resolve", AppealID: targetAppeal._id, Action: "Reopen"
  }, owner.token, owner.id);
  assert.strictEqual(reopenAppealRes.Code, 200, "Owners should be able to reopen appeals");
  assert.strictEqual(reopenAppealRes.Handled, false);
  await sendReq("AdminUpdateUser", { Task: "Unban", UserID: target.id }, owner.token, owner.id);
  console.log("✔ Admin appeals verified");

  // 22. Test session management.
  const sessionsRes = await sendReq("AdminSessions", { Task: "List", Status: "Active" }, owner.token, owner.id);
  assert.strictEqual(sessionsRes.Code, 200, "AdminSessions should return 200");
  assert.ok(sessionsRes.Sessions.some((session: any) => session.UserID === target.id), "Active sessions should include the target user");

  const revokeRes = await sendReq("AdminSessions", {
    Task: "Revoke", UserID: target.id
  }, owner.token, owner.id);
  assert.strictEqual(revokeRes.Code, 200, "Admins should be able to revoke sessions");
  assert.strictEqual(revokeRes.RevokeSessionsFor, target.id);
  const revokedSessionCheck = await sendReq("GetAccountData", {}, target.token, target.id);
  assert.strictEqual(revokedSessionCheck.Code, 401, "Revoked sessions must stop authenticating");

  const cleanupRes = await sendReq("AdminSessions", { Task: "Cleanup" }, owner.token, owner.id);
  assert.strictEqual(cleanupRes.Code, 200, "Session cleanup should return 200");
  assert.ok(cleanupRes.Removed >= 0, "Session cleanup should report the removed count");
  console.log("✔ Admin session management verified");

  // 23. Test staff broadcasts. Connected clients should receive the packet.
  const announcementBroadcast = waitForBroadcast(
    (body) => body.ClientFunction === "AdminAnnouncement" && body.Message === "Admin panel test announcement"
  );
  const broadcastRes = await sendReq("AdminBroadcast", {
    Mode: "Announcement", Message: "Admin panel test announcement", Level: "info"
  }, owner.token, owner.id);
  assert.strictEqual(broadcastRes.Code, 200, "AdminBroadcast should return 200");
  assert.ok(broadcastRes.Delivered >= 1, "Broadcasts should report how many clients received them");
  const announcementPacket = await announcementBroadcast;
  assert.strictEqual(announcementPacket.Level, "info");

  // "Reload" is the forced update path used when a new frontend build ships.
  const reloadBroadcast = waitForBroadcast(
    (body) => body.ClientFunction === "AdminForceRefresh" && body.Mode === "Reload"
  );
  const reloadRes = await sendReq("AdminBroadcast", {
    Mode: "Reload", Message: "Photop has been updated. Reloading…", Level: "info"
  }, owner.token, owner.id);
  assert.strictEqual(reloadRes.Code, 200, "The forced update broadcast should return 200");
  assert.ok(reloadRes.Delivered >= 1, "The forced update should reach connected clients");
  const reloadPacket = await reloadBroadcast;
  assert.strictEqual(reloadPacket.ClientFunction, "AdminForceRefresh");
  assert.strictEqual(reloadPacket.Mode, "Reload");

  const badBroadcastRes = await sendReq("AdminBroadcast", { Mode: "Bogus" }, owner.token, owner.id);
  assert.strictEqual(badBroadcastRes.Code, 400, "Unknown broadcast modes must be rejected");
  console.log("✔ Admin broadcasts verified");

  // 24. Test the audit log records the actions taken above.
  const logRes = await sendReq("AdminLog", {}, owner.token, owner.id);
  assert.strictEqual(logRes.Code, 200, "AdminLog should return 200");
  assert.ok(logRes.Log.length > 0, "AdminLog should be populated");
  assert.ok(logRes.Log.some((entry: any) => entry.Action === "UserBanned"), "Bans should be audited");
  assert.ok(logRes.Log.some((entry: any) => entry.Action === "Broadcast"), "Broadcasts should be audited");
  assert.ok(logRes.Log.every((entry: any) => entry.Actor), "Log entries should identify the actor");
  const moderatorLog = await sendReq("AdminLog", {}, moderator.token, moderator.id);
  assert.strictEqual(moderatorLog.Code, 200, "Moderators should be able to read the audit log");
  console.log("✔ Admin audit log verified");

  // 25. Custom profile URLs replace the opaque user ID in shared links.
  const customSlug = "cool_" + Math.floor(Math.random() * 100000);
  const setCustomURL = await sendReq("UpdateAccountData", {
    Update: [{ Change: "CustomURL", CustomURL: customSlug }]
  }, owner.token, owner.id);
  assert.strictEqual(setCustomURL.Code, 200, "Setting a custom profile URL should succeed");
  assert.strictEqual(setCustomURL.CustomURL, customSlug, "Saved custom URL should be returned");

  const bySlug = await sendReq("GetProfile", { ProfileUserID: customSlug.toUpperCase() }, owner.token, owner.id);
  assert.strictEqual(bySlug.Code, 200, "GetProfile should resolve a custom profile URL");
  assert.strictEqual(bySlug.UserInfo._id, owner.id, "Custom URL should resolve to the right account");
  assert.strictEqual(bySlug.UserInfo.CustomURL, customSlug, "Profiles should expose the custom URL");

  const byID = await sendReq("GetProfile", { ProfileUserID: owner.id }, owner.token, owner.id);
  assert.strictEqual(byID.Code, 200, "The original user ID link should keep working");

  const invalidSlug = await sendReq("UpdateAccountData", {
    Update: [{ Change: "CustomURL", CustomURL: "no spaces!" }]
  }, owner.token, owner.id);
  assert.strictEqual(invalidSlug.Code, 400, "Invalid custom profile URLs should be rejected");

  const takenSlug = await sendReq("UpdateAccountData", {
    Update: [{ Change: "CustomURL", CustomURL: customSlug }]
  }, moderator.token, moderator.id);
  assert.strictEqual(takenSlug.Code, 409, "Duplicate custom profile URLs should be rejected");

  const usernameSlug = await sendReq("UpdateAccountData", {
    Update: [{ Change: "CustomURL", CustomURL: moderator.name }]
  }, owner.token, owner.id);
  assert.strictEqual(usernameSlug.Code, 409, "Custom URLs must not shadow other usernames");

  const clearCustomURL = await sendReq("UpdateAccountData", {
    Update: [{ Change: "CustomURL", CustomURL: "" }]
  }, owner.token, owner.id);
  assert.strictEqual(clearCustomURL.Code, 200, "Clearing the custom profile URL should succeed");
  assert.strictEqual(clearCustomURL.CustomURL, null, "Clearing should return no custom URL");
  const clearedProfile = await sendReq("GetProfile", { ProfileUserID: customSlug }, owner.token, owner.id);
  assert.strictEqual(clearedProfile.Code, 404, "Cleared custom URLs should stop resolving");
  console.log("✔ Custom profile URLs verified");

  // 26. Notifications: liking a post notifies its author, and read state updates.
  const notifPost = await sendReq("CreatePost", { Text: "Notification test post", Media: [] }, owner.token, owner.id);
  assert.strictEqual(notifPost.Code, 200, "Notification test post should be created");
  const notifPostID = notifPost.NewPostID;
  const likeForNotif = await sendReq("LikePost", { PostID: notifPostID }, moderator.token, moderator.id);
  assert.strictEqual(likeForNotif.Code, 200, "Moderator should be able to like the post");

  const notifFeed = await sendReq("GetNotifications", { Amount: 20 }, owner.token, owner.id);
  assert.strictEqual(notifFeed.Code, 200, "Owner should be able to load notifications");
  assert.ok(Array.isArray(notifFeed.Notifications), "Notifications should be an array");
  const likeNotif = notifFeed.Notifications.find((n: any) => n.Type === "LikePost" && n.PostID === notifPostID);
  assert.ok(likeNotif, "A LikePost notification should be created for the author");
  assert.strictEqual(likeNotif.Read, false, "The notification should start unread");
  assert.ok((notifFeed.Unread || 0) >= 1, "Unread count should reflect the new notification");

  const markRead = await sendReq("MarkNotificationsRead", { NotificationIDs: [likeNotif._id] }, owner.token, owner.id);
  assert.strictEqual(markRead.Code, 200, "Marking a notification read should succeed");
  assert.strictEqual(markRead.Unread, notifFeed.Unread - 1, "Unread count should decrement after marking read");

  const afterRead = await sendReq("GetNotifications", { Amount: 20 }, owner.token, owner.id);
  const readNotif = afterRead.Notifications.find((n: any) => n._id === likeNotif._id);
  assert.strictEqual(readNotif.Read, true, "The notification should now be read");

  // Unliking removes the grouped notification once no actors remain.
  const unlikeForNotif = await sendReq("UnlikePost", { PostID: notifPostID }, moderator.token, moderator.id);
  assert.strictEqual(unlikeForNotif.Code, 200, "Moderator should be able to unlike the post");
  const afterUnlike = await sendReq("GetNotifications", { Amount: 20 }, owner.token, owner.id);
  const removedNotif = afterUnlike.Notifications.find((n: any) => n._id === likeNotif._id);
  assert.strictEqual(removedNotif, undefined, "The grouped notification should be removed after the last unlike");
  console.log("✔ Notifications verified");

  // 27. Follow state: every surface that renders a Follow/Unfollow button must be told
  // whether the *viewer* follows each user (hover preview, Followers/Following lists).
  const f1 = await sendReq("FollowUser", { FollowUserID: moderator.id }, owner.token, owner.id);
  assert.strictEqual(f1.Code, 200, "Owner should be able to follow the moderator");
  const f2 = await sendReq("FollowUser", { FollowUserID: moderator.id }, token, userId);
  assert.strictEqual(f2.Code, 200, "Base user should be able to follow the moderator");
  const f3 = await sendReq("FollowUser", { FollowUserID: owner.id }, token, userId);
  assert.strictEqual(f3.Code, 200, "Base user should be able to follow the owner");

  // Hover preview (GetUserInfo)
  const previewFollowing = await sendReq("GetUserInfo", { GetUserID: moderator.id }, owner.token, owner.id);
  assert.strictEqual(previewFollowing.IsFollowing, true, "GetUserInfo should report IsFollowing=true for a followed user");
  const previewNotFollowing = await sendReq("GetUserInfo", { GetUserID: owner.id }, moderator.token, moderator.id);
  assert.strictEqual(previewNotFollowing.IsFollowing, false, "GetUserInfo should report IsFollowing=false for an unfollowed user");
  const previewAnon = await sendReq("GetUserInfo", { GetUserID: moderator.id });
  assert.strictEqual(previewAnon.IsFollowing, false, "GetUserInfo should report IsFollowing=false for logged-out viewers");
  const previewSelf = await sendReq("GetUserInfo", { GetUserID: owner.id }, owner.token, owner.id);
  assert.strictEqual(previewSelf.IsFollowing, false, "GetUserInfo should never report following yourself");

  // Followers / Following lists (GetFollowData): state is relative to the viewer, not the list owner.
  const listAsBase = await sendReq("GetFollowData", { Type: "Followers", GetUserID: moderator.id, Amount: 25 }, token, userId);
  assert.strictEqual(listAsBase.Code, 200, "GetFollowData should return 200");
  assert.strictEqual(listAsBase.Users[owner.id].IsFollowing, true, "Base user follows the owner, so the list should say so");
  assert.strictEqual(listAsBase.Users[userId].IsFollowing, false, "A viewer's own tile should not be marked followed");
  const listAsOwner = await sendReq("GetFollowData", { Type: "Followers", GetUserID: moderator.id, Amount: 25 }, owner.token, owner.id);
  assert.strictEqual(listAsOwner.Users[userId].IsFollowing, false, "Owner does not follow the base user, even though the base user follows the owner");
  const followingList = await sendReq("GetFollowData", { Type: "Following", GetUserID: userId, Amount: 25 }, owner.token, owner.id);
  assert.strictEqual(followingList.Users[moderator.id].IsFollowing, true, "Following list should reflect the viewer's follow of each entry");
  const listAnon = await sendReq("GetFollowData", { Type: "Followers", GetUserID: moderator.id, Amount: 25 });
  assert.strictEqual(listAnon.Users[owner.id].IsFollowing, false, "Logged-out viewers should see IsFollowing=false");

  // Unfollowing flips every surface back.
  const uf = await sendReq("UnfollowUser", { UnfollowUserID: moderator.id }, owner.token, owner.id);
  assert.strictEqual(uf.Code, 200, "Owner should be able to unfollow the moderator");
  const afterUnfollow = await sendReq("GetUserInfo", { GetUserID: moderator.id }, owner.token, owner.id);
  assert.strictEqual(afterUnfollow.IsFollowing, false, "GetUserInfo should reflect an unfollow");
  const afterUnfollowList = await sendReq("GetFollowData", { Type: "Followers", GetUserID: moderator.id, Amount: 25 }, owner.token, owner.id);
  assert.strictEqual(afterUnfollowList.Users[userId].IsFollowing, false, "List should still be viewer-relative after an unfollow");
  console.log("✔ Follow state in GetUserInfo / GetFollowData verified");

  // 28. Removing content removes the notifications it caused, right away.
  const notifsOf = async (u: { token: string; id: string }): Promise<any[]> => {
    const res = await sendReq("GetNotifications", { Amount: 50 }, u.token, u.id);
    assert.strictEqual(res.Code, 200, "GetNotifications should return 200");
    return res.Notifications;
  };
  const base = { token, id: userId };
  const findChat = async (postID: string, text: string, u: { token: string; id: string }) => {
    const res = await sendReq("GetChats", { Post: postID, Amount: 25 }, u.token, u.id);
    const chat = res.Chats.find((c: any) => c.Text === text);
    assert.ok(chat, "Chat should be retrievable");
    return chat._id as string;
  };

  // 28a. Deleting a post drops likes, replies and "new post" notices for it. A
  // grouped "new post" notice shrinks and re-points to the author's newest live post.
  const rmPost1 = (await sendReq("CreatePost", { Text: "Removal test post one", Media: [] }, owner.token, owner.id)).NewPostID;
  const rmPost2 = (await sendReq("CreatePost", { Text: "Removal test post two", Media: [] }, owner.token, owner.id)).NewPostID;
  assert.strictEqual((await sendReq("LikePost", { PostID: rmPost1 }, moderator.token, moderator.id)).Code, 200);
  assert.strictEqual((await sendReq("CreateChat", { PostID: rmPost1, Text: "Chat on removal post" }, moderator.token, moderator.id)).Code, 200);

  let ownerNotifs = await notifsOf(owner);
  assert.ok(ownerNotifs.some(n => n.Type === "LikePost" && n.PostID === rmPost1), "Owner should be notified of the like");
  assert.ok(ownerNotifs.some(n => n.Type === "ChatPost" && n.PostID === rmPost1), "Owner should be notified of the chat");
  let baseNotifs = await notifsOf(base);
  const newPostNotif = baseNotifs.find(n => n.Type === "NewPost" && n.ActorID === owner.id);
  assert.ok(newPostNotif, "A follower should be notified of new posts");
  assert.strictEqual(newPostNotif.PostID, rmPost2, "New-post notice should point at the newest post");
  assert.strictEqual(newPostNotif.Count, 2, "New-post notice should group both posts");

  assert.strictEqual((await sendReq("UpdatePost", { Task: "Delete", PostID: rmPost2 }, owner.token, owner.id)).Code, 200);
  baseNotifs = await notifsOf(base);
  const shrunk = baseNotifs.find(n => n.Type === "NewPost" && n.ActorID === owner.id);
  assert.ok(shrunk, "New-post notice should survive while another post is live");
  assert.strictEqual(shrunk.Count, 1, "New-post notice should shrink when a post is deleted");
  assert.strictEqual(shrunk.PostID, rmPost1, "New-post notice should re-point at the newest live post");

  assert.strictEqual((await sendReq("UpdatePost", { Task: "Delete", PostID: rmPost1 }, owner.token, owner.id)).Code, 200);
  ownerNotifs = await notifsOf(owner);
  assert.ok(!ownerNotifs.some(n => n.PostID === rmPost1), "Deleting a post should remove every notification about it");
  baseNotifs = await notifsOf(base);
  assert.ok(!baseNotifs.some(n => n.Type === "NewPost" && n.ActorID === owner.id), "Last new-post notice should be dropped with its post");

  // 28b. Hiding a chat drops the reply notice and likes on that chat.
  const rmPost3 = (await sendReq("CreatePost", { Text: "Chat removal test post", Media: [] }, owner.token, owner.id)).NewPostID;
  assert.strictEqual((await sendReq("CreateChat", { PostID: rmPost3, Text: "Chat that will be removed" }, base.token, base.id)).Code, 200);
  const rmChatID = await findChat(rmPost3, "Chat that will be removed", base);
  assert.strictEqual((await sendReq("LikeChat", { ChatID: rmChatID }, moderator.token, moderator.id)).Code, 200);
  ownerNotifs = await notifsOf(owner);
  assert.ok(ownerNotifs.some(n => n.Type === "ChatPost" && n.ChatID === rmChatID), "Post author should be notified of the chat");
  baseNotifs = await notifsOf(base);
  assert.ok(baseNotifs.some(n => n.Type === "LikeChat" && n.ChatID === rmChatID), "Chat author should be notified of the like");

  assert.strictEqual((await sendReq("UpdateChat", { ChatID: rmChatID, UpdateValues: [["Hidden", ""]] }, base.token, base.id)).Code, 200);
  ownerNotifs = await notifsOf(owner);
  assert.ok(!ownerNotifs.some(n => n.ChatID === rmChatID), "Removing a chat should remove the post author's notification");
  baseNotifs = await notifsOf(base);
  assert.ok(!baseNotifs.some(n => n.ChatID === rmChatID), "Removing a chat should remove the likes on it");

  // 28c. Quoting: removing the quoting post retracts the quote notification.
  const quotedPost = (await sendReq("CreatePost", { Text: "Post that gets quoted", Media: [] }, owner.token, owner.id)).NewPostID;
  const quoter = await sendReq("CreatePost", { Text: `Quoting this /Post_${quotedPost}`, Media: [] }, base.token, base.id);
  assert.strictEqual(quoter.Code, 200, "Quoting post should be created");
  ownerNotifs = await notifsOf(owner);
  assert.ok(ownerNotifs.some(n => n.Type === "QuotePost" && n.PostID === quotedPost), "Quoted author should be notified");
  assert.strictEqual((await sendReq("UpdatePost", { Task: "Delete", PostID: quoter.NewPostID }, base.token, base.id)).Code, 200);
  ownerNotifs = await notifsOf(owner);
  assert.ok(!ownerNotifs.some(n => n.Type === "QuotePost" && n.PostID === quotedPost), "Deleting the quoting post should retract the quote notification");

  // 28d. A moderator removing a post drops its like notifications but keeps the
  // moderation notice, which exists precisely because the post was removed.
  const modPost = (await sendReq("CreatePost", { Text: "Post that staff will remove", Media: [] }, moderator.token, moderator.id)).NewPostID;
  assert.strictEqual((await sendReq("LikePost", { PostID: modPost }, base.token, base.id)).Code, 200);
  let modNotifs = await notifsOf(moderator);
  assert.ok(modNotifs.some(n => n.Type === "LikePost" && n.PostID === modPost), "Author should be notified of the like");
  const staffDelete = await sendReq("AdminContentAction", { Task: "Delete", Type: "Post", ID: modPost, Reason: "Test removal" }, owner.token, owner.id);
  assert.strictEqual(staffDelete.Code, 200, "Staff should be able to remove the post");
  modNotifs = await notifsOf(moderator);
  assert.ok(!modNotifs.some(n => n.Type === "LikePost" && n.PostID === modPost), "Like notification should go when staff remove the post");
  assert.ok(modNotifs.some(n => n.Type === "ModeratePost" && n.PostID === modPost), "The moderation notice must be kept");
  console.log("✔ Notifications removed with their posts and chats");

  ws.close();
  cleanupTestData();
  console.log("\n==============================================");
  console.log("🎉 ALL TESTS PASSED PERFECTLY!");
  console.log("==============================================");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  try {
    // Failures must not leave test accounts or content behind either.
    cleanupTestData();
  } catch (cleanupErr) {
    console.error("⚠ Test cleanup failed:", cleanupErr);
  }
  process.exit(1);
});
