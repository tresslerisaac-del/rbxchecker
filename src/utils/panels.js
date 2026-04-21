const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

/**
 * Build the main clan creation panel embed + button row
 */
function buildPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('🏰 Clan / Community System')
    .setDescription(
      '**Create your own clan or community!**\n\n' +
      'Click the button below to get started. You can name your channel, ' +
      'set it to open or closed, and manage members.\n\n' +
      '**Requirements:**\n' +
      '• You must have the required base role\n' +
      '• One clan per person (two with special role)\n' +
      '• 6-hour cooldown after deleting'
    )
    .setColor(0x5865f2)
    .setFooter({ text: '18+ Server — All clans are subject to server rules' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('clan_create')
      .setLabel('✨ Create Clan')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Build the clan management panel sent inside the clan channel
 */
function buildClanManagementPanel(clan) {
  const embed = new EmbedBuilder()
    .setTitle(`🏰 ${clan.name}`)
    .setDescription(
      `**Status:** ${clan.is_open ? '🟢 Open' : '🔴 Closed'}\n` +
      `**18+ Mode:** ${clan.is_18plus ? '🔞 Yes' : '❌ No'}\n\n` +
      'Use the buttons below to manage your clan.\n' +
      'Use `/cng`, `/addrole`, `/role`, `/roleall`, `/clanswap` for more options.'
    )
    .setColor(clan.is_open ? 0x57f287 : 0xed4245)
    .setFooter({ text: `Clan ID: ${clan.id}` });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`clan_toggle_${clan.id}`)
      .setLabel(clan.is_open ? '🔴 Close Clan' : '🟢 Open Clan')
      .setStyle(clan.is_open ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`clan_delete_${clan.id}`)
      .setLabel('🗑️ Delete Clan')
      .setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`clan_join_${clan.id}`)
      .setLabel('📩 Request to Join')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1, row2] };
}

/**
 * Modal for naming the clan on creation
 */
function buildNameModal() {
  const modal = new ModalBuilder()
    .setCustomId('clan_name_modal')
    .setTitle('Name Your Clan');

  const nameInput = new TextInputBuilder()
    .setCustomId('clan_name_input')
    .setLabel('Clan Name (leave blank for default)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Leave blank → {username}'s clan")
    .setRequired(false)
    .setMaxLength(50);

  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
  return modal;
}

/**
 * Build an accept/decline DM embed for join requests
 */
function buildJoinRequestDM(requester, clan, requestId) {
  const embed = new EmbedBuilder()
    .setTitle('📩 Clan Join Request')
    .setDescription(
      `**${requester.displayName}** (\`${requester.user.tag}\`) wants to join **${clan.name}**.`
    )
    .setColor(0xfee75c)
    .setThumbnail(requester.displayAvatarURL())
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_accept_${requestId}_${requester.id}`)
      .setLabel('✅ Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`join_decline_${requestId}_${requester.id}`)
      .setLabel('❌ Decline')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  buildPanelMessage,
  buildClanManagementPanel,
  buildNameModal,
  buildJoinRequestDM,
};
