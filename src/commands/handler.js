const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');
const { isAdminOrOwner, resolveColor, hasBypassRole, aiCheckName } = require('../utils/helpers');
const { buildClanManagementPanel, buildPanelMessage } = require('../utils/panels');
const { transferOwner } = require('../utils/db');
const { PANEL_CHANNEL } = require('../utils/constants');

/**
 * Route a slash command to the correct handler
 */
async function handleCommand(interaction) {
  const { commandName } = interaction;

  switch (commandName) {
    case 'cng':      return handleCng(interaction);
    case 'addrole':  return handleAddRole(interaction);
    case 'role':     return handleRole(interaction);
    case 'roleall':  return handleRoleAll(interaction);
    case 'clanswap': return handleClanSwap(interaction);
    case 'listroles': return handleListRoles(interaction);
    case 'panel':    return handlePanel(interaction);
  }
}

// ─── /cng ────────────────────────────────────────────────────────────────────

async function handleCng(interaction) {
  const clan = db.getClanByChannel(interaction.channel.id);
  if (!clan) return reply(interaction, '❌ This command can only be used in a clan channel.');

  const member = interaction.member;
  if (clan.owner_id !== member.id && !isAdminOrOwner(member)) {
    return reply(interaction, '❌ Only the clan owner can rename the channel.');
  }

  const newName = interaction.options.getString('name').trim();

  // Name filter (no bypass role)
  if (!hasBypassRole(member) && !isAdminOrOwner(member)) {
    const check = await aiCheckName(newName);
    if (!check.ok) {
      return reply(interaction, `❌ That name was rejected${check.reason ? `: **${check.reason}**` : '.'}. Choose a different name.`);
    }
  }

  db.updateClanName(clan.id, newName);

  const safeName = newName.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-\u00C0-\u024F\p{Emoji}]/gu, '');
  try {
    await interaction.channel.setName(safeName);
    await interaction.channel.setTopic(`${newName} | Owner: <@${clan.owner_id}>`);
  } catch { /* may lack perms */ }

  // Refresh panel if it exists
  const msgs = await interaction.channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (msgs) {
    const panelMsg = msgs.find(m => m.author.id === interaction.client.user.id && m.embeds.length > 0);
    if (panelMsg) {
      const updatedClan = db.getClanById(clan.id);
      await panelMsg.edit(buildClanManagementPanel(updatedClan)).catch(() => {});
    }
  }

  return reply(interaction, `✅ Clan renamed to **${newName}**!`);
}

// ─── /addrole ────────────────────────────────────────────────────────────────

async function handleAddRole(interaction) {
  const clan = db.getClanByChannel(interaction.channel.id);
  if (!clan) return reply(interaction, '❌ This command can only be used in a clan channel.');

  const member = interaction.member;
  if (clan.owner_id !== member.id && !isAdminOrOwner(member)) {
    return reply(interaction, '❌ Only the clan owner can create roles.');
  }

  const roleName = interaction.options.getString('name').trim();
  const colorStr = interaction.options.getString('color') || null;
  const color = resolveColor(colorStr);

  await interaction.deferReply({ ephemeral: true });

  try {
    const role = await interaction.guild.roles.create({
      name: roleName,
      color,
      permissions: [], // NO administrator or any dangerous perms
      reason: `Clan role for ${clan.name}`,
    });

    db.addClanRole(clan.id, role.id, roleName);

    await interaction.editReply(`✅ Role **${roleName}** created! Use \`/role @user ${role.id}\` or \`/roleall ${role.id}\` to apply it.`);
  } catch (err) {
    console.error('[handleAddRole]', err);
    await interaction.editReply('❌ Failed to create role. Make sure the bot has the Manage Roles permission.');
  }
}

// ─── /role ────────────────────────────────────────────────────────────────────

async function handleRole(interaction) {
  const clan = db.getClanByChannel(interaction.channel.id);
  if (!clan) return reply(interaction, '❌ Use this inside your clan channel.');

  const member = interaction.member;
  if (clan.owner_id !== member.id && !isAdminOrOwner(member)) {
    return reply(interaction, '❌ Only the clan owner can assign roles.');
  }

  const target = interaction.options.getMember('user');
  const roleId = interaction.options.getString('role_id').trim();

  // Verify role belongs to this clan
  const clanRoles = db.getClanRoles(clan.id);
  const clanRole = clanRoles.find(r => r.role_id === roleId);
  if (!clanRole) {
    return reply(interaction, `❌ That role doesn't belong to this clan. Use \`/listroles\` to see your roles.`);
  }

  try {
    await target.roles.add(roleId);
    return reply(interaction, `✅ Gave <@${target.id}> the **${clanRole.role_name}** role.`);
  } catch {
    return reply(interaction, '❌ Failed to assign role. Check bot permissions.');
  }
}

// ─── /roleall ─────────────────────────────────────────────────────────────────

async function handleRoleAll(interaction) {
  const clan = db.getClanByChannel(interaction.channel.id);
  if (!clan) return reply(interaction, '❌ Use this inside your clan channel.');

  const member = interaction.member;
  if (clan.owner_id !== member.id && !isAdminOrOwner(member)) {
    return reply(interaction, '❌ Only the clan owner can assign roles.');
  }

  const roleId = interaction.options.getString('role_id').trim();
  const clanRoles = db.getClanRoles(clan.id);
  const clanRole = clanRoles.find(r => r.role_id === roleId);
  if (!clanRole) {
    return reply(interaction, `❌ That role doesn't belong to this clan. Use \`/listroles\`.`);
  }

  await interaction.deferReply({ ephemeral: true });

  const members = db.getMembers(clan.id);
  let success = 0;
  for (const row of members) {
    try {
      const m = await interaction.guild.members.fetch(row.user_id);
      await m.roles.add(roleId);
      success++;
    } catch { /* ignore */ }
  }

  await interaction.editReply(`✅ Applied **${clanRole.role_name}** to ${success}/${members.length} members.`);
}

// ─── /clanswap ───────────────────────────────────────────────────────────────

async function handleClanSwap(interaction) {
  const clan = db.getClanByChannel(interaction.channel.id);
  if (!clan) return reply(interaction, '❌ Use this inside your clan channel.');

  const member = interaction.member;
  if (clan.owner_id !== member.id && !isAdminOrOwner(member)) {
    return reply(interaction, '❌ Only the clan owner can transfer ownership.');
  }

  const newOwner = interaction.options.getMember('user');
  if (!newOwner || newOwner.id === member.id) {
    return reply(interaction, '❌ Please select a different member to transfer to.');
  }

  // Must be a member of the clan
  if (!db.isMember(clan.id, newOwner.id)) {
    return reply(interaction, '❌ That user is not a member of your clan. They must join first.');
  }

  transferOwner(clan.id, newOwner.id);

  // Update channel permissions
  try {
    await interaction.channel.permissionOverwrites.edit(member.id, {
      ManageMessages: false,
      ManageChannels: false,
    });
    await interaction.channel.permissionOverwrites.create(newOwner.id, {
      ViewChannel: true,
      SendMessages: true,
      ManageMessages: true,
      ManageChannels: true,
    });
    await interaction.channel.setTopic(`${clan.name} | Owner: <@${newOwner.id}>`);
  } catch { /* ignore perm errors */ }

  // Refresh management panel
  const msgs = await interaction.channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (msgs) {
    const panelMsg = msgs.find(m => m.author.id === interaction.client.user.id && m.embeds.length > 0);
    if (panelMsg) {
      const updatedClan = db.getClanById(clan.id);
      await panelMsg.edit(buildClanManagementPanel(updatedClan)).catch(() => {});
    }
  }

  // DM new owner
  try {
    await newOwner.send(`🏰 You are now the owner of **${clan.name}**! <@${member.id}> transferred ownership to you.`);
  } catch { /* DMs closed */ }

  return reply(interaction, `✅ Ownership of **${clan.name}** transferred to <@${newOwner.id}>.`);
}

// ─── /listroles ──────────────────────────────────────────────────────────────

async function handleListRoles(interaction) {
  const clan = db.getClanByChannel(interaction.channel.id);
  if (!clan) return reply(interaction, '❌ Use this inside your clan channel.');

  const roles = db.getClanRoles(clan.id);
  if (!roles.length) {
    return reply(interaction, '📋 No custom roles created yet. Use `/addrole` to create one.');
  }

  const embed = new EmbedBuilder()
    .setTitle(`${clan.name} — Custom Roles`)
    .setDescription(roles.map(r => `<@&${r.role_id}> — ID: \`${r.role_id}\``).join('\n'))
    .setColor(0x5865f2);

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── /panel (admin only) ─────────────────────────────────────────────────────

async function handlePanel(interaction) {
  if (!isAdminOrOwner(interaction.member)) {
    return reply(interaction, '❌ You need Administrator to use this command.');
  }

  const channel = interaction.guild.channels.cache.get(PANEL_CHANNEL);
  if (!channel) {
    return reply(interaction, `❌ Could not find panel channel <#${PANEL_CHANNEL}>. Check the PANEL_CHANNEL config.`);
  }

  await channel.send(buildPanelMessage());
  return reply(interaction, `✅ Panel sent to <#${PANEL_CHANNEL}>.`);
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function reply(interaction, content) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ content, ephemeral: true });
  }
  return interaction.reply({ content, ephemeral: true });
}

module.exports = { handleCommand };
