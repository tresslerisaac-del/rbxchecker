require('dotenv').config();

module.exports = {
  TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,

  // Roles
  CLAN_BASE_ROLE: process.env.CLAN_BASE_ROLE || '1496186334874697828',
  CLAN_BYPASS_ROLE: process.env.CLAN_BYPASS_ROLE || '1496186443805229168',
  CLAN_DOUBLE_ROLE: process.env.CLAN_DOUBLE_ROLE || null,
  ROLE_18PLUS: process.env.ROLE_18PLUS || null,

  // Channels
  PANEL_CHANNEL: process.env.PANEL_CHANNEL || '1496187286302490644',

  // IDs
  SERVER_OWNER_ID: process.env.SERVER_OWNER_ID || '1487316298969911409',

  // Cooldown duration in seconds (6 hours)
  COOLDOWN_SECONDS: 6 * 60 * 60,

  // Clan name rules
  MAX_CLAN_NAME_LENGTH: 50,

  CLAN_RULES_DM: `
🏰 **Clan Owner Rules & Info**

Welcome to your new clan! Here's everything you need to know:

**Commands (usable only in your clan channel):**
\`/cng {new name}\` — Rename your clan channel (supports emojis)
\`/addrole {name} {color}\` — Create a custom role for your clan (no Administrator permission allowed)
\`/role @user {role}\` — Apply one of your custom roles to a specific member
\`/roleall {role}\` — Apply one of your custom roles to all members
\`/clanswap @user\` — Transfer clan ownership to another member

**Panel Buttons (in your clan channel):**
• **Open / Close** — Toggle who can join your clan
  - Open: anyone can join (unless you have 18+ mode, then only verified members)
  - Closed: no new members; existing members can still chat
• **Request** (for non-members) — Sends you a DM with accept/decline buttons
• **Delete Clan** — Permanently deletes your clan, DMs all members, removes custom roles

**18+ Mode:**
If you have the 18+ verified role, your clan automatically enforces it. Unverified members are auto-removed.

**Clan Limit:**
- Default: 1 clan at a time
- Special role: 2 clans at a time
- After deleting a clan, you must wait **6 hours** before creating a new one (unless you have the 2-clan role)

**Rules:**
1. No admin permissions may be given to any custom role
2. You are responsible for your community
3. Violations may result in your clan being removed by server staff

Have fun building your community! 🎉
`,
};
