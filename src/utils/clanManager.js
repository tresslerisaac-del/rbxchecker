const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');
const { hasBaseRole, hasBypassRole, has18PlusRole, isAdminOrOwner, clanLimit, aiCheckName } = require('../utils/helpers');
const { buildClanManagementPanel } = require('../utils/panels');
const { CLAN_RULES_DM, PANEL_CHANNEL, ROLE_18PLUS } = require('../utils/constants');

/**
 * Handle the clan creation flow after the name modal is submitted
 */
async function handleClanCreate(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;
  const guildId = guild.id;

  // ── Role check ──────────────────────────────────────────────────────────────
  if (!hasBaseRole(member)) {
    return interaction.reply({
      content: '❌ You do not have the required role to create a clan.',
      ephemeral: true,
    });
  }

  // ── Cooldown check ──────────────────────────────────────────────────────────
  const cooldownLimit = clanLimit(member);
  const cooldownUntil = db.getCooldown(member.id);
  if (cooldownUntil && cooldownLimit < 2) {
    const ts = Math.floor(cooldownUntil);
    return interaction.reply({
      content: `⏰ You're on cooldown! You can create a new clan <t:${ts}:R>.`,
      ephemeral: true,
    });
  }

  // ── Clan count check ────────────────────────────────────────────────────────
  const existing = db.getClanByOwner(member.id, guildId);
  if (existing.length >= cooldownLimit) {
    return interaction.reply({
      content: `❌ You already have ${existing.length} clan(s). You can only own ${cooldownLimit === Infinity ? 'unlimited' : cooldownLimit}.`,
      ephemeral: true,
    });
  }

  // ── Name ────────────────────────────────────────────────────────────────────
  let clanName = interaction.fields?.getTextInputValue('clan_name_input')?.trim() || '';
  if (!clanName) {
    clanName = `${member.displayName}'s clan`;
  }

  // Name filter — only if no bypass role
  if (!hasBypassRole(member) && !isAdminOrOwner(member)) {
    const check = await aiCheckName(clanName);
    if (!check.ok) {
      return interaction.reply({
        content: `❌ That clan name was rejected${check.reason ? `: **${check.reason}**` : '.'}. Please choose a different name.`,
        ephemeral: true,
      });
    }
  }

  const is18plus = has18PlusRole(member);

  await interaction.deferReply({ ephemeral: true });

  try {
    // ── Create the channel ──────────────────────────────────────────────────
    const channel = await guild.channels.create({
      name: clanName.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-\u00C0-\u024F\u1E00-\u1EFF\p{Emoji}]/gu, ''),
      type: ChannelType.GuildText,
      topic: `${clanName} — Clan channel | Owner: <@${member.id}>`,
      permissionOverwrites: buildChannelPerms(guild, member, is18plus),
    });

    // ── Save to DB ──────────────────────────────────────────────────────────
    const clanId = db.createClan(member.id, channel.id, guildId, clanName, is18plus);
    const clan = db.getClanById(clanId);

    // ── Send management panel inside the new channel ────────────────────────
    const panel = buildClanManagementPanel(clan);
    await channel.send({ content: `Welcome, <@${member.id}>! 🏰 This is your clan channel.`, ...panel });

    // ── DM the owner the rules ───────────────────────────────────────────────
    try {
      await member.send(CLAN_RULES_DM);
    } catch {
      // DMs may be closed — not critical
    }

    await interaction.editReply({
      content: `✅ Your clan **${clanName}** has been created! Check out <#${channel.id}>.`,
    });
  } catch (err) {
    console.error('[handleClanCreate]', err);
    await interaction.editReply({ content: '❌ Something went wrong creating your clan. Please try again.' });
  }
}

/**
 * Build permission overwrites for a new clan channel
 */
function buildChannelPerms(guild, owner, is18plus) {
  const overwrites = [
    {
      id: guild.roles.everyone,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    },
    {
      id: owner.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  if (is18plus && ROLE_18PLUS) {
    overwrites.push({
      id: ROLE_18PLUS,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    });
  }

  return overwrites;
}

/**
 * Toggle clan open/close
 */
async function handleClanToggle(interaction, clan) {
  const member = interaction.member;

  if (clan.owner_id !== member.id && !isAdminOrOwner(member)) {
    return interaction.reply({ content: '❌ Only the clan owner can toggle this.', ephemeral: true });
  }

  const newState = !clan.is_open;
  db.updateClanOpen(clan.id, newState);

  // Update channel topic
  const channel = interaction.channel;
  try {
    await channel.setTopic(
      `${clan.name} — ${newState ? '🟢 Open' : '🔴 Closed'} | Owner: <@${clan.owner_id}>`
    );
  } catch { /* ignore */ }

  // Refresh the management panel
  const updatedClan = db.getClanById(clan.id);
  const panel = buildClanManagementPanel(updatedClan);

  try {
    await interaction.message.edit(panel);
  } catch { /* message may not exist */ }

  await interaction.reply({
    content: newState ? '🟢 Clan is now **open**. Anyone can join!' : '🔴 Clan is now **closed**. No new members.',
    ephemeral: true,
  });
}

/**
 * Delete a clan — DM members, remove roles, delete channel, set cooldown
 */
async function handleClanDelete(interaction, clan) {
  const member = interaction.member;

  if (clan.owner_id !== member.id && !isAdminOrOwner(member)) {
    return interaction.reply({ content: '❌ Only the clan owner can delete this clan.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;

  // ── DM all members ──────────────────────────────────────────────────────────
  const members = db.getMembers(clan.id);
  const dmEmbed = new EmbedBuilder()
    .setTitle('🗑️ Clan Deleted')
    .setDescription(`The clan **${clan.name}** has been deleted by the owner.`)
    .setColor(0xed4245)
    .setTimestamp();

  for (const row of members) {
    if (row.user_id === member.id) continue;
    try {
      const m = await guild.members.fetch(row.user_id);
      await m.send({ embeds: [dmEmbed] });
    } catch { /* skip if DMs closed or user left */ }
  }

  // ── Remove custom roles ─────────────────────────────────────────────────────
  const clanRoles = db.getClanRoles(clan.id);
  for (const cr of clanRoles) {
    try {
      const role = guild.roles.cache.get(cr.role_id);
      if (role) await role.delete('Clan deleted');
    } catch { /* ignore */ }
  }

  // ── Soft-delete in DB ───────────────────────────────────────────────────────
  db.deleteClan(clan.id);

  // ── Set cooldown (owner only, and only if not double-clan role) ─────────────
  const ownerMember = await guild.members.fetch(clan.owner_id).catch(() => null);
  if (ownerMember) {
    const limit = clanLimit(ownerMember);
    const newCount = db.getClanByOwner(clan.owner_id, guild.id).length;
    if (limit !== Infinity && newCount === 0) {
      db.setCooldown(clan.owner_id);
    }
  }

  // ── Delete the channel ──────────────────────────────────────────────────────
  try {
    await interaction.editReply({ content: '✅ Clan deleted. Goodbye!' });
    setTimeout(() => interaction.channel.delete('Clan deleted').catch(() => {}), 3000);
  } catch { /* channel may already be gone */ }
}

/**
 * Handle join request sent to clan owner via DM
 */
async function handleJoinRequest(interaction, clan) {
  const requester = interaction.member;
  const guild = interaction.guild;

  if (!clan.is_open) {
    return interaction.reply({
      content: '🔴 This clan is currently closed. You can request to join anyway and the owner will decide.',
      ephemeral: true,
    });
  }

  if (db.isMember(clan.id, requester.id)) {
    return interaction.reply({ content: '✅ You are already a member of this clan.', ephemeral: true });
  }

  // 18+ guard
  if (clan.is_18plus && ROLE_18PLUS) {
    if (!requester.roles.cache.has(ROLE_18PLUS)) {
      return interaction.reply({
        content: '🔞 This clan requires the 18+ verified role to join.',
        ephemeral: true,
      });
    }
  }

  // Fetch owner
  const owner = await guild.members.fetch(clan.owner_id).catch(() => null);
  if (!owner) {
    return interaction.reply({ content: '❌ Could not reach the clan owner.', ephemeral: true });
  }

  // Check for existing pending request
  const existing = db.getJoinRequest(clan.id, requester.id);
  if (existing) {
    return interaction.reply({ content: '⏳ You already have a pending join request for this clan.', ephemeral: true });
  }

  // Create a placeholder request so we can store the DM message ID
  const { buildJoinRequestDM } = require('../utils/panels');
  const dmPayload = buildJoinRequestDM(requester, clan, 0); // id=0 placeholder

  let dmMessage;
  try {
    dmMessage = await owner.send(dmPayload);
  } catch {
    return interaction.reply({ content: '❌ Could not DM the clan owner. They may have DMs disabled.', ephemeral: true });
  }

  // Save request with real message ID
  db.createJoinRequest(clan.id, requester.id, dmMessage.id);
  const req = db.getJoinRequest(clan.id, requester.id);

  // Re-edit DM with correct button IDs
  const realPayload = buildJoinRequestDM(requester, clan, req.id);
  await dmMessage.edit(realPayload).catch(() => {});

  await interaction.reply({
    content: '📩 Your join request has been sent to the clan owner!',
    ephemeral: true,
  });
}

/**
 * Accept a join request (triggered from owner DM)
 */
async function handleJoinAccept(interaction, requestId, requesterId) {
  const { updateJoinRequest, getJoinRequest, getClanById, addMember } = db;

  // Find request
  const allPending = interaction.client.guilds.cache;
  // We need to find which guild this belongs to
  // Since this is a DM interaction, we resolve through guild search
  const req = interaction.client._joinRequests?.get(parseInt(requestId));

  // Simpler: re-query by requester across all known clans
  // We embed clan+request IDs in button customId: join_accept_{reqId}_{userId}
  // So we can just mark it resolved and notify

  // The request row has clan_id — but we need to look it up differently
  // since we don't store it per-client. Use a cross-guild scan:
  let clanId, guildId, channelId;
  for (const [, guild] of interaction.client.guilds.cache) {
    const clans = guild.channels.cache;
    // We'll resolve via the DB directly
    break;
  }

  // Direct DB query
  const Database = require('better-sqlite3');
  const path = require('path');
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/clans.db');
  const rawDb = new Database(DB_PATH);
  const reqRow = rawDb.prepare('SELECT * FROM join_requests WHERE id = ?').get(parseInt(requestId));

  if (!reqRow || reqRow.status !== 'pending') {
    return interaction.update({ content: '⚠️ This request has already been handled.', components: [] });
  }

  const clan = rawDb.prepare('SELECT * FROM clans WHERE id = ?').get(reqRow.clan_id);
  rawDb.close();

  if (!clan) {
    return interaction.update({ content: '❌ Clan no longer exists.', components: [] });
  }

  // Find guild
  const guild = interaction.client.guilds.cache.get(clan.guild_id);
  if (!guild) return interaction.update({ content: '❌ Could not find guild.', components: [] });

  // Only the clan owner or admin can accept
  const actingMember = interaction.user;
  if (clan.owner_id !== actingMember.id) {
    return interaction.update({ content: '❌ Only the clan owner can accept requests.', components: [] });
  }

  addMember(clan.id, requesterId);
  updateJoinRequest(reqRow.id, 'accepted');

  // Grant channel view perms
  const channel = guild.channels.cache.get(clan.channel_id);
  if (channel) {
    await channel.permissionOverwrites.create(requesterId, {
      ViewChannel: true,
      SendMessages: true,
    }).catch(() => {});
  }

  // DM the requester
  try {
    const requesterUser = await guild.members.fetch(requesterId);
    await requesterUser.send(`✅ Your request to join **${clan.name}** has been **accepted**! Check out <#${clan.channel_id}>.`);
  } catch { /* DMs closed */ }

  await interaction.update({ content: `✅ Accepted <@${requesterId}> into **${clan.name}**.`, components: [] });
}

/**
 * Decline a join request
 */
async function handleJoinDecline(interaction, requestId, requesterId) {
  const { updateJoinRequest } = db;

  const Database = require('better-sqlite3');
  const path = require('path');
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/clans.db');
  const rawDb = new Database(DB_PATH);
  const reqRow = rawDb.prepare('SELECT * FROM join_requests WHERE id = ?').get(parseInt(requestId));
  const clan = reqRow ? rawDb.prepare('SELECT * FROM clans WHERE id = ?').get(reqRow.clan_id) : null;
  rawDb.close();

  if (!reqRow || reqRow.status !== 'pending') {
    return interaction.update({ content: '⚠️ This request has already been handled.', components: [] });
  }

  if (clan?.owner_id !== interaction.user.id) {
    return interaction.update({ content: '❌ Only the clan owner can decline requests.', components: [] });
  }

  updateJoinRequest(reqRow.id, 'declined');

  // DM requester
  if (clan) {
    const guild = interaction.client.guilds.cache.get(clan.guild_id);
    if (guild) {
      try {
        const requesterMember = await guild.members.fetch(requesterId);
        await requesterMember.send(`❌ Your request to join **${clan.name}** has been **declined**.`);
      } catch { /* DMs closed */ }
    }
  }

  await interaction.update({ content: `❌ Declined <@${requesterId}>'s join request.`, components: [] });
}

module.exports = {
  handleClanCreate,
  handleClanToggle,
  handleClanDelete,
  handleJoinRequest,
  handleJoinAccept,
  handleJoinDecline,
};
