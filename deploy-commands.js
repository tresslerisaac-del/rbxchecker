require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const { DISCORD_TOKEN, CLIENT_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in your .env file.");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("send")
    .setDescription("Send the server information panel.")
    .setDMPermission(false)
    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log("Registering global slash commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log("Global slash command /send registered.");
  } catch (error) {
    console.error(error);
  }
})();