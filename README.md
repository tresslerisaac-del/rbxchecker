# 🎮 Roblox Username Checker Bot

A Discord bot that checks for available Roblox usernames (3L, 4L, 5L) and sends results privately via DM and a temporary channel.

---

## ✨ Features

- Dropdown panel for selecting 3, 4, or 5 character username searches
- Results sent to user's DMs (up to 10 usernames)
- Auto-creates a private `{username}'s Private Tagz` channel that deletes after 1 hour
- Role-based access and cooldown system
- Owner and admin control commands

---

## 🚀 Setup

### 1. Clone the repo
```bash
git clone https://github.com/yourusername/roblox-checker.git
cd roblox-checker
```

### 2. Create your `.env` file
```bash
cp .env.example .env
```
Fill in your values:
```
DISCORD_TOKEN=your_bot_token_here
CHANNEL_ID=1495409305317277829
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

### 4. Run the bot
```bash
python bot.py
```

### 5. Send the panel (first time only)
In any Discord channel the bot can see, run:
```
!sendpanel
```

---

## 🚂 Railway Hosting

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard:
   - `DISCORD_TOKEN`
   - `CHANNEL_ID`
4. Railway will auto-detect the `Procfile` and run the worker

---

## ⚙️ IDs (pre-configured)

| Setting | ID |
|---|---|
| Owner | `1487316298969911409` |
| Allowed Role | `1495408646266556416` |
| Fast Role (30s cooldown) | `1495408761819500777` |
| Panel Channel | `1495409305317277829` |

---

## 📋 Commands

> Only the owner or admins can use these.

| Command | Description |
|---|---|
| `!on` | Enable the dropdown for all allowed users |
| `!off` | Disable the dropdown (owner can still use it) |
| `!resend` | Delete old panel and send a fresh one |
| `!sendpanel` | Send the panel for the first time |

---

## ⏱️ Cooldowns

| User Type | Cooldown |
|---|---|
| Default | 60 seconds |
| Fast Role | 30 seconds |
| Owner | 5 seconds |

---

## ⚠️ Notes

- Roblox's API may rate-limit heavy scanning. The bot uses a 1.2s delay between checks.
- Short usernames are extremely rare — scans sample random combinations, so results may vary.
- The bot respects Roblox's ToS by avoiding aggressive automated scraping.
