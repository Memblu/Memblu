# Photop Revival

This repository contains the full revival of **Photop**, an open-source social platform featuring per-post live chats, media sharing, and real-time WebSocket interactions.

Because the original backend was lost media, the backend has been reverse-engineered and rebuilt from scratch in TypeScript/Node.js to match 100% of the client contracts in `PhotopFrontend`.

## Project Structure

```
PhotopRevival/
├── Dockerfile               # Production container image
├── docker-compose.yml       # Production one-command container launch
├── PhotopFrontend/          # Original client frontend (vanilla JS, DOM-based SPA)
│   └── public/
│       ├── index.html       # Entry point
│       ├── MainUi.js        # Core layout & navigation
│       ├── Feed.js          # Feed view & auth UI
│       ├── BridgeConnect.js # WebSocket RPC client ("BridgeConnect")
│       ├── PostRender.js    # Post rendering & live chat UI
│       └── ...
└── PhotopBackend/           # Recreated backend
    ├── src/
    │   ├── server.ts        # Express HTTP server & static web server
    │   ├── wsServer.ts      # WebSocket RPC gateway (/Server1)
    │   ├── db.ts            # SQLite database with WAL mode (node:sqlite)
    │   ├── auth.ts          # Password hashing & session management
    │   ├── media.ts         # Multipart image upload handler
    │   ├── admin.ts         # Admin CLI tool (set-role, unban, stats, etc.)
    │   ├── handlers/        # RPC task handlers (posts, chats, profiles, auth, settings)
    │   └── test.ts          # Automated integration test suite
    ├── data/                # SQLite database storage (data/photop.sqlite)
    └── media/               # Uploaded images (PostImages/, ProfileImages/, ProfileBanners/)
```

## Quick Start

### 1. Start the Server Locally

```bash
cd ~/PhotopRevival/PhotopBackend
npm run dev
```

The server will start on port `3000`:
- **Web App**: [http://localhost:3000](http://localhost:3000)
- **WebSocket Gateway**: `ws://localhost:3000/Server1`
- **Image Upload API**: `http://localhost:3000/ImageUpload`
- **Media CDN**: `http://localhost:3000/media/`

Open [http://localhost:3000](http://localhost:3000) in your browser to sign up, create posts, upload images, and chat live!

### 2. Admin Management CLI

Promote yourself to `Owner` (👑) or `Moderator` (🛡️), inspect users, or view platform statistics:

```bash
cd ~/PhotopRevival/PhotopBackend

# List all registered users
npm run admin list-users

# Grant badges/roles (Owner, Moderator, Developer, Verified, Partner, etc.)
npm run admin set-role <Username> Owner

# View platform statistics (users, posts, chats, likes, follows)
npm run admin stats

# Unban a user
npm run admin unban <Username>
```

### 3. Run Automated Integration Tests

```bash
cd ~/PhotopRevival/PhotopBackend
npm test
```

Verifies all 11 core subsystems:
- WebSocket handshake & `CreateConnection`
- Account registration & login sessions
- Post creation & feed querying
- Post liking & unliking
- Per-post live chat rooms & realtime messaging
- Profile viewing
- Multipart image uploads & static media serving

### 4. Custom Domain / Public Dev Testing

The backend dynamically generates a `/config.js` that tells the frontend where to connect.  
By default it uses `location.host` (works perfectly for localhost). To expose via a public tunnel just set two environment variables.

#### Using ngrok or something

```bash
# 1. Start the server
cd ~/PhotopRevival/PhotopBackend
npm run dev

# 2. In a second terminal, start ngrok
ngrok http 3000
# → Forwarding  https://abc123.ngrok-free.app → localhost:3000

# 3. Create / update PhotopBackend/.env
cat > .env <<'EOF'
PUBLIC_DOMAIN=abc123.ngrok-free.app
PUBLIC_PROTOCOL=https
BYPASS_CAPTCHA=true
EOF

# 4. Restart the server so it picks up the new .env
# (Ctrl-C the first terminal, then npm run dev again)
```

Now share `https://abc123.ngrok-free.app` — the frontend will connect to the correct WebSocket and media URLs automatically.

#### Using Cloudflare Tunnel (`cloudflared`)

```bash
# 1. Start the server as above
# 2. Run the tunnel
cloudflared tunnel --url http://localhost:3000
# → Your quick Tunnel has been created: https://xyz.trycloudflare.com

# 3. Set .env
cat > .env <<'EOF'
PUBLIC_DOMAIN=xyz.trycloudflare.com
PUBLIC_PROTOCOL=https
BYPASS_CAPTCHA=true
EOF
# 4. Restart server
```

#### All supported `.env` variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP + WS listen port |
| `PUBLIC_DOMAIN` | *(derived from request)* | Hostname exposed to users (no scheme) |
| `PUBLIC_PROTOCOL` | `https` | `https` or `http` |
| `BYPASS_CAPTCHA` | `true` | Skip hCaptcha; set `false` in prod |
| `HCAPTCHA_SECRET_KEY` | — | hCaptcha secret (prod only) |
| `HCAPTCHA_SITE_KEY` | *(Photop original)* | hCaptcha site key (prod only) |

Copy [`.env.example`](PhotopBackend/.env.example) to `PhotopBackend/.env` as a starting point.

---

### 5. Docker Deployment

To run in a container with persistent volumes (reads `PhotopBackend/.env` automatically):

```bash
cd ~/PhotopRevival
docker compose up -d
```
