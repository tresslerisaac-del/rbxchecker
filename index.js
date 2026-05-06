require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const { DISCORD_TOKEN, CLIENT_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in Railway Variables.");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("send")
    .setDescription("Send the server information panel.")
    .setDMPermission(false)
    .toJSON()
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  console.log("Registering global slash command /send...");

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );

  console.log("Global slash command /send registered.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "send") return;

  if (!interaction.guild) {
    return interaction.reply({
      content: "This command can only be used inside a server.",
      ephemeral: true
    });
  }

  const guild = await interaction.guild.fetch();

  const serverIcon = guild.iconURL({
    size: 1024,
    extension: "png"
  });

  const serverName = guild.name;
  const serverDescription = guild.description || "No server description is set.";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Server Panel")
    .setThumbnail(serverIcon)
    .addFields(
      {
        name: "Server Name",
        value: serverName,
        inline: false
      },
      {
        name: "Server Description",
        value: serverDescription,
        inline: false
      }
    )
    .setFooter({
      text: `Server ID: ${guild.id}`
    })
    .setTimestamp();

  if (serverIcon) {
    embed.setImage(serverIcon);
  }

  await interaction.reply({
    embeds: [embed]
  });
});

(async () => {
  try {
    await registerCommands();
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error("Bot startup failed:", error);
    process.exit(1);
  }
})();
