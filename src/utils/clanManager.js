const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const db = require('./db');
const { hasBaseRole, hasBypassRole, has18PlusRole, isAdminOrOwner, clanLimit, aiCheckName } = require('./helpers');
const { buildClanManagementPanel, buildJoinRequestDM } = require('./panels');
const { CLAN_RULES_DM, ROLE_18PLUS } = require('./constants');

async function handleClanCreate(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;

  if (!hasBaseRole(member)) {
    return interaction.reply({ content: '❌ You do not have the required role to create a clan.', ephemeral: true });
  }

  const cooldownLimit = clanLimit(member);
  const cooldownUntil = db.getCooldown(member.id);
  if (cooldownUntil && cooldownLimit < 2) {
    return interaction.reply({ content: `⏰ You're on cooldown! You can create a new clan <t:${Math.floor(cooldownUntil)}:R>.`, ephemeral: true });
  }

  const existing = db.getClanByOwner(member.id, guild.id);
  if (existing.length >= cooldownLimit) {
    return interaction.reply({ content: `❌ You already own ${existing.length} clan(s). Maximum: ${cooldownLimit === Infinity ? 'unlimited' : cooldownLimit}.`, ephemeral: true });
  }

  let clanName = interaction.fields?.getTextInputValue('clan_name_input')?.trim() || '';
  if (!clanName) clanName = `${member.displayName}'s clan`;

  if (!hasBypassRole(member) && !isAdminOrOwner(member)) {
    const check = await aiCheckName(clanName);
    if (!check.ok) {
      return interaction.reply({ content: `❌ That name was rejected${check.reason ? `: **${check.reason}**` : '.'}`, ephemeral: true });
    }
  }

  const is18plus = has18PlusRole(member);
  await interaction.deferReply({ ephemeral: true });

  try {
    const safeName = clanName.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]/g, '').slice(0, 50) || 'clan';
    const channel = await guild.channels.create({
      name: safeName,
      type: ChannelType.GuildText,
      topic: `${clanName} — Owner: <@${member.id}>`,
      permissionOverwrites: buildChannelPerms(guild, member, is18plus),
    });

    const clanId = db.createClan(member.id, channel.id, guild.id, clanName, is18plus);
    const clan = db.getClanById(clanId);

    const panel = buildClanManagementPanel(clan);
    await channel.send({ content: `Welcome, <@${member.id}>! 🏰 This is your clan channel.`, ...panel });

    try { await member.send(CLAN_RULES_DM); } catch { /* DMs closed */ }

    await interaction.editReply({ content: `✅ Your clan **${clanName}** has been created! Check out <#${channel.id}>.` });
  } catch (err) {
    console.error('[handleClanCreate]', err);
    await interaction.editReply({ content: '❌ Something went wrong. Please try again.' });
  }
}

function buildChannelPerms(guild, owner, is18plus) {
  const overwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    { id: owner.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels] },
  ];
  if (is18plus && ROLE_18PLUS) {
    overwrites.push({ id: ROLE_18PLUS, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  }
  return overwrites;
}

async function handleClanToggle(interaction, clan) {
  const member = interaction.member;
  if (clan.owner_id !== member.id && !isAdminOrOwner(member)) {
    return interaction.reply({ content: '❌ Only the clan owner can toggle this.', ephemeral: true });
  }

  const newState = !clan.is_open;
  db.updateClanOpen(clan.id, newState);

  try { await interaction.channel.setTopic(`${clan.name} — ${newState ? '🟢 Open' : '🔴 Closed'} | Owner: <@${clan.owner_id}>`); } catch { }

  const updatedClan = db.getClanById(clan.id);
  try { await interaction.message.edit(buildClanManagementPanel(updatedClan)); } catch { }

  await interaction.reply({ content: newState ? '🟢 Clan is now **open**!' : '🔴 Clan is now **closed**.', ephemeral: true });
}

async function handleClanDelete(interaction, clan) {
  const member = interaction.member;
  if (clan.owner_id !== member.id && !isAdminOrOwner(member)) {
    return interaction.reply({ content: '❌ Only the clan owner can delete this clan.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;

  const members = db.getMembers(clan.id);
  const dmEmbed = new EmbedBuilder()
    .setTitle('🗑️ Clan Deleted')
    .setDescription(`The clan **${clan.name}** has been deleted.`)
    .setColor(0xed4245).setTimestamp();

  for (const row of members) {
    if (row.user_id === member.id) continue;
    try { const m = await guild.members.fetch(row.user_id); await m.send({ embeds: [dmEmbed] }); } catch { }
  }

  const clanRoles = db.getClanRoles(clan.id);
  for (const cr of clanRoles) {
    try { const role = guild.roles.cache.get(cr.role_id); if (role) await role.delete('Clan deleted'); } catch { }
  }

  db.deleteClan(clan.id);

  const ownerMember = await guild.members.fetch(clan.owner_id).catch(() => null);
  if (ownerMember && clanLimit(ownerMember) !== Infinity) {
    const remaining = db.getClanByOwner(clan.owner_id, guild.id);
    if (remaining.length === 0) db.setCooldown(clan.owner_id);
  }

  try {
    await interaction.editReply({ content: '✅ Clan deleted. Goodbye!' });
    setTimeout(() => interaction.channel.delete('Clan deleted').catch(() => {}), 3000);
  } catch { }
}

async function handleJoinRequest(interaction, clan) {
  const requester = interaction.member;

  if (db.isMember(clan.id, requester.id)) {
    return interaction.reply({ content: '✅ You are already a member of this clan.', ephemeral: true });
  }

  if (clan.is_18plus && ROLE_18PLUS && !requester.roles.cache.has(ROLE_18PLUS)) {
    return interaction.reply({ content: '🔞 This clan requires the 18+ verified role to join.', ephemeral: true });
  }

  if (!clan.is_open) {
    // Still allow sending a request even when closed
  }

  const existing = db.getJoinRequest(clan.id, requester.id);
  if (existing) return interaction.reply({ content: '⏳ You already have a pending join request.', ephemeral: true });

  const owner = await interaction.guild.members.fetch(clan.owner_id).catch(() => null);
  if (!owner) return interaction.reply({ content: '❌ Could not reach the clan owner.', ephemeral: true });

  const placeholder = buildJoinRequestDM(requester, clan, 0);
  let dmMessage;
  try { dmMessage = await owner.send(placeholder); }
  catch { return interaction.reply({ content: '❌ Could not DM the clan owner. They may have DMs disabled.', ephemeral: true }); }

  db.createJoinRequest(clan.id, requester.id, dmMessage.id);
  const req = db.getJoinRequest(clan.id, requester.id);

  await dmMessage.edit(buildJoinRequestDM(requester, clan, req.id)).catch(() => {});
  await interaction.reply({ content: '📩 Your join request has been sent to the clan owner!', ephemeral: true });
}

async function handleJoinAccept(interaction, requestId, requesterId) {
  const reqRow = db.getJoinRequestById(parseInt(requestId));
  if (!reqRow || reqRow.status !== 'pending') {
    return interaction.update({ content: '⚠️ This request has already been handled.', components: [] });
  }

  const clan = db.getClanById(reqRow.clan_id);
  if (!clan) return interaction.update({ content: '❌ Clan no longer exists.', components: [] });
  if (clan.owner_id !== interaction.user.id) return interaction.update({ content: '❌ Only the clan owner can accept requests.', components: [] });

  const guild = interaction.client.guilds.cache.get(clan.guild_id);
  if (!guild) return interaction.update({ content: '❌ Could not find guild.', components: [] });

  db.addMember(clan.id, requesterId);
  db.updateJoinRequest(reqRow.id, 'accepted');

  const channel = guild.channels.cache.get(clan.channel_id);
  if (channel) await channel.permissionOverwrites.create(requesterId, { ViewChannel: true, SendMessages: true }).catch(() => {});

  try { const m = await guild.members.fetch(requesterId); await m.send(`✅ Your request to join **${clan.name}** was **accepted**! Check out <#${clan.channel_id}>.`); } catch { }

  await interaction.update({ content: `✅ Accepted <@${requesterId}> into **${clan.name}**.`, components: [] });
}

async function handleJoinDecline(interaction, requestId, requesterId) {
  const reqRow = db.getJoinRequestById(parseInt(requestId));
  if (!reqRow || reqRow.status !== 'pending') {
    return interaction.update({ content: '⚠️ This request has already been handled.', components: [] });
  }

  const clan = db.getClanById(reqRow.clan_id);
  if (clan?.owner_id !== interaction.user.id) return interaction.update({ content: '❌ Only the clan owner can decline requests.', components: [] });

  db.updateJoinRequest(reqRow.id, 'declined');

  if (clan) {
    const guild = interaction.client.guilds.cache.get(clan.guild_id);
    if (guild) {
      try { const m = await guild.members.fetch(requesterId); await m.send(`❌ Your request to join **${clan.name}** was **declined**.`); } catch { }
    }
  }

  await interaction.update({ content: `❌ Declined <@${requesterId}>'s join request.`, components: [] });
}

module.exports = { handleClanCreate, handleClanToggle, handleClanDelete, handleJoinRequest, handleJoinAccept, handleJoinDecline };
