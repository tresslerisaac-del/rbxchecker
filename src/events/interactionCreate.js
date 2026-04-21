const db = require('../utils/db');
const { buildNameModal } = require('../utils/panels');
const {
  handleClanCreate,
  handleClanToggle,
  handleClanDelete,
  handleJoinRequest,
  handleJoinAccept,
  handleJoinDecline,
} = require('../utils/clanManager');

/**
 * Route a button/modal interaction to the correct handler
 */
async function handleInteraction(interaction) {
  // ── Modals ────────────────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'clan_name_modal') {
      return handleClanCreate(interaction);
    }
    return;
  }

  // ── Buttons ───────────────────────────────────────────────────────────────
  if (!interaction.isButton()) return;

  const { customId } = interaction;

  // clan_create — open the name modal
  if (customId === 'clan_create') {
    return interaction.showModal(buildNameModal());
  }

  // clan_toggle_{clanId}
  if (customId.startsWith('clan_toggle_')) {
    const clanId = parseInt(customId.split('_')[2]);
    const clan = db.getClanById(clanId);
    if (!clan) return interaction.reply({ content: '❌ Clan not found.', ephemeral: true });
    return handleClanToggle(interaction, clan);
  }

  // clan_delete_{clanId}
  if (customId.startsWith('clan_delete_')) {
    const clanId = parseInt(customId.split('_')[2]);
    const clan = db.getClanById(clanId);
    if (!clan) return interaction.reply({ content: '❌ Clan not found.', ephemeral: true });
    return handleClanDelete(interaction, clan);
  }

  // clan_join_{clanId}
  if (customId.startsWith('clan_join_')) {
    const clanId = parseInt(customId.split('_')[2]);
    const clan = db.getClanById(clanId);
    if (!clan) return interaction.reply({ content: '❌ Clan not found.', ephemeral: true });
    return handleJoinRequest(interaction, clan);
  }

  // join_accept_{requestId}_{userId}
  if (customId.startsWith('join_accept_')) {
    const parts = customId.split('_');
    const requestId = parts[2];
    const userId = parts[3];
    return handleJoinAccept(interaction, requestId, userId);
  }

  // join_decline_{requestId}_{userId}
  if (customId.startsWith('join_decline_')) {
    const parts = customId.split('_');
    const requestId = parts[2];
    const userId = parts[3];
    return handleJoinDecline(interaction, requestId, userId);
  }
}

module.exports = { handleInteraction };
