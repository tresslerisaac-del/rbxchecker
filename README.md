# 🏰 Clan Bot — Discord Community System

A full-featured Discord bot for creating and managing clan/community channels, with role gating, 18+ enforcement, join requests, custom roles, and more.

---

## ✨ Features

| Feature | Details |
|---|---|
| Clan creation panel | Interactive button in a designated channel |
| Role gating | Base role required; bypass role skips name filter |
| AI name moderation | OpenAI checks names for users without bypass role |
| 18+ enforcement | Auto-removes unverified members from 18+ clans |
| Open / Close toggle | Control who can join |
| Join requests | DM-based accept/decline system |
| Custom clan roles | Owners can create and apply roles (no admin perm) |
| Clan limit | 1 default, 2 with special role, infinite for admins |
| 6-hour cooldown | After deleting a clan before creating a new one |
| Ownership transfer | `/clanswap @user` |
| Full delete flow | DMs all members, removes roles, deletes channel |

---

## 📁 Project Structure

```
clanbot/
├── src/
│   ├── index.js                  # Bot entry point
│   ├── deploy.js                 # Slash command registration script
│   ├── commands/
│   │   ├── definitions.js        # Slash command definitions
│   │   └── handler.js            # Slash command logic
│   ├── events/
│   │   ├── interactionCreate.js  # Button & modal handler
│   │   └── memberUpdate.js       # 18+ enforcement
│   └── utils/
│       ├── constants.js          # Config & role IDs
│       ├── db.js                 # SQLite database layer
│       ├── helpers.js            # Permission checks, AI filter
│       ├── clanManager.js        # Core clan logic
│       └── panels.js             # Embed/button builders
├── data/                         # SQLite DB stored here (auto-created)
├── .env.example                  # Copy to .env and fill in
├── .gitignore
├── package.json
├── Procfile
└── railway.json
```

---

## 🚀 Setup Guide

### Step 1 — Create the Discord Bot

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** → click **Add Bot**
4. Under **Token**, click **Reset Token** and copy it — this is your `DISCORD_TOKEN`
5. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Manage Channels`, `Manage Roles`, `Send Messages`, `Read Messages/View Channels`, `Manage Messages`, `Read Message History`
7. Copy the generated URL and open it to invite the bot to your server

---

### Step 2 — Get Your IDs

You need these values for the `.env` file:

| Value | How to get it |
|---|---|
| `DISCORD_TOKEN` | Bot page → Token |
| `CLIENT_ID` | Application page → Application ID |
| `GUILD_ID` | Right-click your server → Copy Server ID (enable Developer Mode first) |
| `CLAN_DOUBLE_ROLE` | Right-click the role → Copy Role ID |
| `ROLE_18PLUS` | Right-click the role → Copy Role ID |

> **Enable Developer Mode:** Discord Settings → Advanced → Developer Mode ✅

---

### Step 3 — Configure Environment Variables

Copy `.env.example` to `.env` and fill it in:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_server_id
OPENAI_API_KEY=your_openai_key        # Optional but recommended
CLAN_BASE_ROLE=1496186334874697828    # Already set
CLAN_BYPASS_ROLE=1496186443805229168  # Already set
CLAN_DOUBLE_ROLE=ROLE_ID_HERE         # Role that allows 2 clans
ROLE_18PLUS=ROLE_ID_HERE              # Your 18+ verified role
PANEL_CHANNEL=1496187286302490644     # Already set
SERVER_OWNER_ID=1487316298969911409   # Already set
```

---

### Step 4 — Register Slash Commands

Run this once before starting the bot:

```bash
npm install
node src/deploy.js
```

You should see:
```
✅ Successfully registered 7 commands to guild YOUR_GUILD_ID.
```

---

### Step 5 — Send the Panel

Start the bot locally first to test:

```bash
node src/index.js
```

Then in Discord, run:
```
/panel
```

This sends the **✨ Create Clan** panel to your configured panel channel.

---

## 🚂 Deploy to Railway (via GitHub)

### Step 1 — Push to GitHub

```bash
# In the clanbot/ folder:
git init
git add .
git commit -m "Initial clan bot"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/clan-bot.git
git push -u origin main
```

### Step 2 — Create Railway Project

1. Go to [https://railway.app](https://railway.app) and log in
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `clan-bot` repository
4. Railway will auto-detect it as a Node.js app

### Step 3 — Add Environment Variables in Railway

In your Railway project:
1. Click your service → **Variables** tab
2. Click **+ New Variable** and add each one from your `.env`:

```
DISCORD_TOKEN      = your_bot_token
CLIENT_ID          = your_application_id
GUILD_ID           = your_server_id
OPENAI_API_KEY     = your_openai_key
CLAN_BASE_ROLE     = 1496186334874697828
CLAN_BYPASS_ROLE   = 1496186443805229168
CLAN_DOUBLE_ROLE   = your_double_role_id
ROLE_18PLUS        = your_18plus_role_id
PANEL_CHANNEL      = 1496187286302490644
SERVER_OWNER_ID    = 1487316298969911409
DEPLOY_ON_START    = false
```

### Step 4 — Add Persistent Volume for the Database

By default Railway's filesystem is ephemeral (resets on redeploy). To keep your clan data:

1. In Railway, click **+ New** → **Volume**
2. Attach it to your bot service
3. Set the **Mount Path** to `/app/data`
4. Add this variable:
   ```
   DB_PATH = /app/data/clans.db
   ```

### Step 5 — Deploy

Railway will automatically deploy when you push to `main`. You can also trigger a manual deploy from the dashboard.

Check the **Logs** tab to confirm:
```
✅ Logged in as YourBot#1234
```

---

## 🎮 Bot Commands Reference

### User Commands

| Command | Where | Description |
|---|---|---|
| Panel button | Panel channel | Create a new clan |
| `/cng {name}` | Clan channel | Rename your clan (emojis supported) |
| `/addrole {name} {color}` | Clan channel | Create a custom clan role |
| `/role @user {role_id}` | Clan channel | Give a custom role to one member |
| `/roleall {role_id}` | Clan channel | Give a custom role to all members |
| `/clanswap @user` | Clan channel | Transfer ownership |
| `/listroles` | Clan channel | List your custom clan roles |

### Admin Commands

| Command | Description |
|---|---|
| `/panel` | Send the creation panel to the panel channel |

### Panel Buttons (inside clan channels)

| Button | Who | Action |
|---|---|---|
| 🟢 Open / 🔴 Close | Owner + Admin | Toggle join mode |
| 🗑️ Delete Clan | Owner + Admin | Deletes clan, DMs members, removes roles |
| 📩 Request to Join | Non-members | Sends join request to owner's DMs |

---

## 🔞 18+ System

- If a clan owner has the 18+ role (`ROLE_18PLUS`), their clan is automatically marked 18+
- When a non-18+ member tries to join → blocked
- If a member loses the 18+ role → automatically removed from all 18+ clans they're in
- Owner is DM'd with accept/decline buttons for join requests

---

## 🤖 AI Name Filter

- Applies to users **without** the bypass role (`CLAN_BYPASS_ROLE`)
- Uses `gpt-4o-mini` to check for extreme slurs, shock content, etc.
- Normal gaming names, mild themes, pop culture — all pass
- If `OPENAI_API_KEY` is not set, the filter is skipped (fail-open)

---

## ⚠️ Bot Permissions Required

Make sure the bot role is **above** all clan-created roles in the server's role hierarchy, otherwise it cannot manage them.

Required permissions:
- `Manage Channels`
- `Manage Roles`
- `Send Messages`
- `View Channels`
- `Manage Messages`
- `Read Message History`

---

## 🐛 Troubleshooting

| Problem | Fix |
|---|---|
| Commands not showing up | Run `node src/deploy.js` again |
| Bot can't create roles | Move bot role higher in server settings |
| DB resets on redeploy | Add a Railway Volume at `/app/data` |
| DMs not sending | User has DMs disabled — not an error |
| 18+ not being enforced | Make sure `ROLE_18PLUS` env var is set correctly |
