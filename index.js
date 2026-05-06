require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events
} = require("discord.js");

const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN in your .env file.");
  process.exit(1);
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

  if (interaction.commandName === "send") {
    if (!interaction.guild) {
      return interaction.reply({
        content: "This command can only be used inside a server.",
        ephemeral: true
      });
    }

    const guild = await interaction.guild.fetch();

    const serverIcon = guild.iconURL({
      size: 1024
    });

    const serverName = guild.name;
    const serverDescription =
      guild.description || "No server description is set.";

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
  }
});

client.login(DISCORD_TOKEN);