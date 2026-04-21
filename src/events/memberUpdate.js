const db = require('../utils/db');
const { ROLE_18PLUS } = require('../utils/constants');

/**
 * Fired when a member's roles change — enforce 18+ guard in real-time.
 * Also handles when a member is added to a channel via the join flow.
 */
async function handleGuildMemberUpdate(oldMember, newMember) {
  if (!ROLE_18PLUS) return;

  // Check if the member just lost the 18+ role
  const hadRole = oldMember.roles.cache.has(ROLE_18PLUS);
  const hasRole = newMember.roles.cache.has(ROLE_18PLUS);

  if (hadRole && !hasRole) {
    // They lost 18+ — remove them from any 18+ clans
    await enforce18PlusRemoval(newMember);
  }
}

/**
 * Fired when a new member joins the server — check all 18+ clans they might be in.
 */
async function handleGuildMemberAdd(member) {
  if (!ROLE_18PLUS) return;
  // On join they have no roles yet, so we just let the join request flow handle it.
}

/**
 * Remove a member from all 18+ clans they're in (and revoke channel access).
 */
async function enforce18PlusRemoval(member) {
  const guild = member.guild;

  // Find all clans in this guild that are 18+
  const { getDb } = require('../utils/db');
  const allClans = getDb().prepare(`
    SELECT * FROM clans
    WHERE guild_id = ? AND is_18plus = 1 AND deleted_at IS NULL
  `).all(guild.id);

  for (const clan of allClans) {
    const isMember = db.isMember(clan.id, member.id);
    if (!isMember) continue;

    // Remove from channel
    const channel = guild.channels.cache.get(clan.channel_id);
    if (channel) {
      await channel.permissionOverwrites.delete(member.id).catch(() => {});
    }

    // Remove from DB
    db.removeMember(clan.id, member.id);

    // DM the removed member
    try {
      await member.send(
        `🔞 You have been removed from **${clan.name}** because you no longer have the 18+ verified role.`
      );
    } catch { /* DMs closed */ }
  }
}

module.exports = { handleGuildMemberUpdate, handleGuildMemberAdd };
