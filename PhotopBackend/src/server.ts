import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { createWebSocketServer } from "./wsServer.js";
import { validateSession } from "./auth.js";
import { getVapidPublicKey } from "./notifications.js";
import { mediaDir, savePostImage, saveProfileImage, saveProfileBanner, getMediaContentType } from "./media.js";

// Load .env file if present
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

const app = express();
const server = http.createServer(app);

// Trust proxy for reverse proxies (Cloudflare, Caddy, Nginx, ngrok)
app.set("trust proxy", true);

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  storage: multer.memoryStorage()
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS headers
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Dynamic /config.js for client configuration (custom domain, tunnels, dev captcha bypass)
app.get("/config.js", (req, res) => {
  // Priority: 1. Process ENV PUBLIC_DOMAIN -> 2. X-Forwarded-Host -> 3. Host header
  const configuredHost = process.env.PUBLIC_DOMAIN;
  const requestHost = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost:3000";
  const host = configuredHost || requestHost;

  // Determine protocol (https vs http, wss vs ws)
  let proto = process.env.PUBLIC_PROTOCOL;
  if (!proto) {
    const forwardedProto = req.headers["x-forwarded-proto"] as string;
    proto = forwardedProto || req.protocol || "http";
  }
  const wsProto = proto === "https" ? "wss" : "ws";

  const bypassCaptcha = process.env.BYPASS_CAPTCHA !== "false"; // default true for dev
  const hCaptchaSiteKey = process.env.HCAPTCHA_SITE_KEY || "";

  const config = {
    serverDomain: `${wsProto}://${host}/Server1`,
    imageUploadDomain: `${proto}://${host}/ImageUpload`,
    mediaUrl: `${proto}://${host}/media/`,
    bypassCaptcha,
    hCaptchaSiteKey,
    // Empty when VAPID keys are not configured; the client disables push then.
    vapidPublicKey: getVapidPublicKey()
  };

  res.setHeader("Content-Type", "application/javascript");
  res.send(`window.__PHOTOP_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`);
});

// Uploaded media keeps the extensionless IDs used by the original client, so
// derive the Content-Type from the file's magic bytes instead of its path.
function serveMedia(dir: string) {
  return express.static(dir, {
    setHeaders: (res, filePath) => {
      res.setHeader("Content-Type", getMediaContentType(filePath));
      res.setHeader("X-Content-Type-Options", "nosniff");
    }
  });
}

// Serve media storage under both /media and top-level paths
app.use("/media", serveMedia(mediaDir));
app.use("/ProfileImages", serveMedia(path.join(mediaDir, "ProfileImages")));
app.use("/PostImages", serveMedia(path.join(mediaDir, "PostImages")));
app.use("/ProfileBanners", serveMedia(path.join(mediaDir, "ProfileBanners")));

// HTTP Image Upload endpoint
app.post("/ImageUpload", upload.any(), (req, res) => {
  try {
    const rawData = req.body.RequestData;
    if (!rawData) {
      return res.status(400).json({ error: "Missing RequestData" });
    }

    const requestData = JSON.parse(rawData);
    const { Type, AccountData, Metadata } = requestData;

    const user = validateSession(AccountData?.AuthToken, AccountData?.UserID);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    if (Type === "PostImageUpload") {
      const postId = Metadata?.PostID;
      if (!postId) {
        return res.status(400).json({ error: "Missing PostID" });
      }
      for (let i = 0; i < files.length; i++) {
        savePostImage(postId, i, files[i].buffer);
      }
    } else if (Type === "ProfileImageUpload") {
      const picId = saveProfileImage(user.id, files[0].buffer);
      return res.status(200).json({ success: true, ProfilePic: picId });
    } else if (Type === "ProfileBannerUpload") {
      const bannerId = saveProfileBanner(user.id, files[0].buffer);
      return res.status(200).json({ success: true, ProfileBanner: bannerId });
    }

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("ImageUpload error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Serve static frontend files
const frontendDir = path.resolve(process.cwd(), "../PhotopFrontend/public");
app.use(express.static(frontendDir));

// Fallback to index.html for SPA routes
app.use((req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

// Attach WebSocket server on /Server1
createWebSocketServer(server);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, "0.0.0.0", () => {
  const displayDomain = process.env.PUBLIC_DOMAIN || `localhost:${PORT}`;
  const displayProto = process.env.PUBLIC_PROTOCOL || "http";
  const displayWs = displayProto === "https" ? "wss" : "ws";

  console.log(`===============================================`);
  console.log(`Photop Revival Server running!`);
  console.log(`Local Access:       http://localhost:${PORT}`);
  if (process.env.PUBLIC_DOMAIN) {
    console.log(`Public Domain:      ${displayProto}://${displayDomain}`);
    console.log(`Public WebSocket:   ${displayWs}://${displayDomain}/Server1`);
  } else {
    console.log(`Public Domain:      Auto-detected from Host / Reverse Proxy`);
  }
  console.log(`Image Upload API:   ${displayProto}://${displayDomain}/ImageUpload`);
  console.log(`Media Files:        ${displayProto}://${displayDomain}/media/`);
  console.log(`Captcha Mode:       ${process.env.BYPASS_CAPTCHA !== "false" ? "Dev Bypass Enabled" : "Active"}`);
  console.log(`===============================================`);
});
