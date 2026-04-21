require('dotenv').config();
const { REST, Routes } = require('discord.js');
const commands = require('./commands/definitions');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`🔄 Registering ${commands.length} slash commands...`);

    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands.map(c => c.toJSON()) }
    );

    console.log(`✅ Successfully registered ${data.length} commands to guild ${process.env.GUILD_ID}.`);
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
    process.exit(1);
  }
})();
