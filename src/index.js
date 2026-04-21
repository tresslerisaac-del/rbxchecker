require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { TOKEN } = require('./utils/constants');
const { initDb } = require('./utils/db');
const { handleCommand } = require('./commands/handler');
const { handleInteraction } = require('./events/interactionCreate');
const { handleGuildMemberUpdate, handleGuildMemberAdd } = require('./events/memberUpdate');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  c.user.setActivity('🏰 /cng | /addrole | /clanswap');
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else await handleInteraction(interaction);
  } catch (err) {
    console.error('[InteractionCreate]', err);
    const msg = { content: '❌ An error occurred. Please try again.', ephemeral: true };
    if (interaction.replied || interaction.deferred) interaction.followUp(msg).catch(() => {});
    else interaction.reply(msg).catch(() => {});
  }
});

client.on(Events.GuildMemberUpdate, handleGuildMemberUpdate);
client.on(Events.GuildMemberAdd, handleGuildMemberAdd);
client.on('error', err => console.error('[Client Error]', err));
process.on('unhandledRejection', err => console.error('[UnhandledRejection]', err));

(async () => {
  try {
    await initDb();
    console.log('✅ Database ready');
    await client.login(TOKEN);
  } catch (err) {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  }
})();
