const { PermissionFlagsBits } = require('discord.js');
const { CLAN_BASE_ROLE, CLAN_BYPASS_ROLE, CLAN_DOUBLE_ROLE, ROLE_18PLUS, SERVER_OWNER_ID, OPENAI_API_KEY } = require('./constants');

/**
 * Check if member has the base clan role (can use the system at all)
 */
function hasBaseRole(member) {
  return member.roles.cache.has(CLAN_BASE_ROLE);
}

/**
 * Check if member has bypass role (no name filtering)
 */
function hasBypassRole(member) {
  return member.roles.cache.has(CLAN_BYPASS_ROLE);
}

/**
 * Check if member has 18+ role
 */
function has18PlusRole(member) {
  if (!ROLE_18PLUS) return false;
  return member.roles.cache.has(ROLE_18PLUS);
}

/**
 * Check if member can have 2 clans
 */
function hasDoubleRole(member) {
  if (!CLAN_DOUBLE_ROLE) return false;
  return member.roles.cache.has(CLAN_DOUBLE_ROLE);
}

/**
 * Check if member is server owner or has admin
 */
function isAdminOrOwner(member) {
  if (member.id === SERVER_OWNER_ID) return true;
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * How many clans can this member own?
 */
function clanLimit(member) {
  if (isAdminOrOwner(member)) return Infinity;
  if (hasDoubleRole(member)) return 2;
  return 1;
}

/**
 * Use OpenAI to check if a clan name is appropriate
 * Returns { ok: boolean, reason?: string }
 */
async function aiCheckName(name) {
  if (!OPENAI_API_KEY) return { ok: true }; // Skip if no key configured

  try {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a Discord server moderator for a 18+ community. 
Your job is to check if a clan/community name is acceptable.
Acceptable: normal words, gaming terms, pop culture, mild themes.
NOT acceptable: extreme slurs, direct hate speech, extremely explicit sexual terms, shock content.
Respond with JSON only: {"ok": true} or {"ok": false, "reason": "short reason"}`,
        },
        { role: 'user', content: `Clan name to check: "${name}"` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 100,
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error('[aiCheckName] Error:', err.message);
    return { ok: true }; // Fail open if API is down
  }
}

/**
 * Resolve a hex color string to a Discord-compatible integer
 * Accepts: #RRGGBB, RRGGBB, color names
 */
function resolveColor(colorStr) {
  if (!colorStr) return 0x5865f2; // Discord blurple default
  const hex = colorStr.replace('#', '');
  const parsed = parseInt(hex, 16);
  if (!isNaN(parsed)) return parsed;
  return 0x5865f2;
}

module.exports = {
  hasBaseRole,
  hasBypassRole,
  has18PlusRole,
  hasDoubleRole,
  isAdminOrOwner,
  clanLimit,
  aiCheckName,
  resolveColor,
};
