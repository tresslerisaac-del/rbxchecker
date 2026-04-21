require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} = require('discord.js');

const { TOKEN } = require('./utils/constants');
const { handleCommand } = require('./commands/handler');
const { handleInteraction } = require('./events/interactionCreate');
const { handleGuildMemberUpdate, handleGuildMemberAdd } = require('./events/memberUpdate');

// ── Client setup ──────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Channel, // Needed for DM interactions
    Partials.Message,
  ],
});

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  c.user.setActivity('🏰 /cng | /addrole | /clanswap');

  // Register commands on startup if DEPLOY_ON_START is set
  if (process.env.DEPLOY_ON_START === 'true') {
    const { execSync } = require('child_process');
    try {
      execSync('node src/deploy.js', { stdio: 'inherit' });
    } catch { /* non-fatal */ }
  }
});

// ── Interactions (buttons, modals, slash commands) ────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else {
      await handleInteraction(interaction);
    }
  } catch (err) {
    console.error('[InteractionCreate]', err);
    const msg = { content: '❌ An error occurred. Please try again.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      interaction.followUp(msg).catch(() => {});
    } else {
      interaction.reply(msg).catch(() => {});
    }
  }
});

// ── Member events (18+ enforcement) ──────────────────────────────────────────
client.on(Events.GuildMemberUpdate, handleGuildMemberUpdate);
client.on(Events.GuildMemberAdd, handleGuildMemberAdd);

// ── Error handling ────────────────────────────────────────────────────────────
client.on('error', err => console.error('[Client Error]', err));
process.on('unhandledRejection', err => console.error('[UnhandledRejection]', err));

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(TOKEN);
