import { WebSocket } from "ws";
import http from "node:http";
import assert from "node:assert";

const BASE_URL = "http://127.0.0.1:3000";
const WS_URL = "ws://127.0.0.1:3000/Server1";

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

  ws.on("message", (raw) => {
    const data = JSON.parse(raw.toString());
    if (data.Metadata?.ReqSource === "Client") {
      const id = data.Metadata.SentMetadata?.ReqID;
      if (id !== undefined && awaiting.has(id)) {
        awaiting.get(id)!(data.Body);
        awaiting.delete(id);
      }
    }
  });

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
  console.log("✔ ConnectLiveChat & CreateChat verified");

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

  ws.close();
  console.log("\n==============================================");
  console.log("🎉 ALL 12 TESTS PASSED PERFECTLY!");
  console.log("==============================================");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
