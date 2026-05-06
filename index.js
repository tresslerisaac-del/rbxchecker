require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");

const { DISCORD_TOKEN, CLIENT_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in Railway Variables.");
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, "servers.json");

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function cleanInvite(input) {
  return input
    .trim()
    .replace("https://discord.gg/", "")
    .replace("http://discord.gg/", "")
    .replace("https://discord.com/invite/", "")
    .replace("http://discord.com/invite/", "")
    .split("?")[0]
    .split("/")[0];
}

function getGuildIcon(guildLike) {
  if (!guildLike) return null;

  try {
    return guildLike.iconURL({
      size: 1024,
      extension: "png"
    });
  } catch {
    return null;
  }
}

function trimText(text, max = 1024) {
  if (!text) return "No server description is set.";
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

const commands = [
  new SlashCommandBuilder()
    .setName("send")
    .setDescription("Send the server information panel.")
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("addserver")
    .setDescription("Add another server to this server's panel.")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("invite")
        .setDescription("Discord server invite link or invite code.")
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("removeserver")
    .setDescription("Open a panel to remove saved servers.")
    .setDMPermission(false)
    .toJSON()
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  console.log("Registering global slash commands...");

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );

  console.log("Global slash commands registered.");
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
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) {
        return interaction.reply({
          content: "This command can only be used inside a server.",
          ephemeral: true
        });
      }

      if (interaction.commandName === "send") {
        await handleSend(interaction);
      }

      if (interaction.commandName === "addserver") {
        await handleAddServer(interaction);
      }

      if (interaction.commandName === "removeserver") {
        await handleRemoveServerPanel(interaction);
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("remove-server:")) {
        await handleRemoveServerSelect(interaction);
      }
    }
  } catch (error) {
    console.error(error);

    const message = {
      content: "Something went wrong while running that command.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message);
    } else {
      await interaction.reply(message);
    }
  }
});

async function handleSend(interaction) {
  const data = loadData();
  const savedServers = data[interaction.guild.id] || [];

  const guild = await interaction.guild.fetch();

  const currentServerIcon = getGuildIcon(guild);
  const currentDescription = trimText(guild.description);

  const embeds = [];

  const mainEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Server Panel")
    .addFields(
      {
        name: "Server Name",
        value: guild.name,
        inline: false
      },
      {
        name: "Server Description",
        value: currentDescription,
        inline: false
      }
    )
    .setFooter({
      text: `Server ID: ${guild.id}`
    })
    .setTimestamp();

  if (currentServerIcon) {
    mainEmbed.setThumbnail(currentServerIcon);
    mainEmbed.setImage(currentServerIcon);
  }

  embeds.push(mainEmbed);

  for (const saved of savedServers.slice(0, 9)) {
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(saved.name || "Unknown Server")
      .addFields(
        {
          name: "Server Description",
          value: trimText(saved.description),
          inline: false
        }
      )
      .setFooter({
        text: `Server ID: ${saved.guildId}`
      });

    if (saved.iconURL) {
      embed.setThumbnail(saved.iconURL);
    }

    if (saved.inviteURL) {
      embed.setURL(saved.inviteURL);
    }

    embeds.push(embed);
  }

  await interaction.reply({
    embeds
  });
}

async function handleAddServer(interaction) {
  await interaction.deferReply({
    ephemeral: true
  });

  const inviteInput = interaction.options.getString("invite", true);
  const inviteCode = cleanInvite(inviteInput);

  let invite;

  try {
    invite = await client.fetchInvite(inviteCode);
  } catch {
    return interaction.editReply({
      content: "That invite link/code is invalid, expired, or I cannot fetch it."
    });
  }

  if (!invite.guild) {
    return interaction.editReply({
      content: "I could not find a server attached to that invite."
    });
  }

  const invitedGuild = invite.guild;
  const invitedGuildId = invitedGuild.id;

  if (invitedGuildId === interaction.guild.id) {
    return interaction.editReply({
      content: "You cannot add this server because it is already the main server shown in `/send`."
    });
  }

  const data = loadData();

  if (!data[interaction.guild.id]) {
    data[interaction.guild.id] = [];
  }

  const existing = data[interaction.guild.id].find(
    (server) => server.guildId === invitedGuildId
  );

  const inviteURL = `https://discord.gg/${invite.code}`;

  const savedServer = {
    guildId: invitedGuildId,
    name: invitedGuild.name || "Unknown Server",
    description: invitedGuild.description || "No server description is set.",
    iconURL: getGuildIcon(invitedGuild),
    inviteURL,
    addedBy: interaction.user.id,
    addedAt: new Date().toISOString()
  };

  if (existing) {
    Object.assign(existing, savedServer);
  } else {
    data[interaction.guild.id].push(savedServer);
  }

  saveData(data);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(existing ? "Server Updated" : "Server Added")
    .setDescription(`**${savedServer.name}** has been added to this server's /send panel.`)
    .addFields(
      {
        name: "Description",
        value: trimText(savedServer.description),
        inline: false
      }
    );

  if (savedServer.iconURL) {
    embed.setThumbnail(savedServer.iconURL);
  }

  await interaction.editReply({
    embeds: [embed]
  });
}

async function handleRemoveServerPanel(interaction) {
  const data = loadData();
  const savedServers = data[interaction.guild.id] || [];

  const removableServers = savedServers.filter(
    (server) => server.guildId !== interaction.guild.id
  );

  if (removableServers.length === 0) {
    return interaction.reply({
      content: "There are no removable servers saved for this panel.",
      ephemeral: true
    });
  }

  const options = removableServers.slice(0, 25).map((server) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(server.name.slice(0, 100))
      .setDescription(`Remove server ID: ${server.guildId}`.slice(0, 100))
      .setValue(server.guildId)
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`remove-server:${interaction.guild.id}`)
    .setPlaceholder("Choose a server to remove")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Remove Server")
    .setDescription("Select a saved server from the dropdown below to remove it from `/send`.");

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
}

async function handleRemoveServerSelect(interaction) {
  const guildIdFromMenu = interaction.customId.split(":")[1];

  if (!interaction.guild || interaction.guild.id !== guildIdFromMenu) {
    return interaction.reply({
      content: "This removal panel does not belong to this server.",
      ephemeral: true
    });
  }

  const selectedGuildId = interaction.values[0];

  if (selectedGuildId === interaction.guild.id) {
    return interaction.reply({
      content: "You cannot remove your own server from its own panel.",
      ephemeral: true
    });
  }

  const data = loadData();
  const savedServers = data[interaction.guild.id] || [];

  const serverToRemove = savedServers.find(
    (server) => server.guildId === selectedGuildId
  );

  if (!serverToRemove) {
    return interaction.update({
      content: "That server is no longer saved.",
      embeds: [],
      components: []
    });
  }

  data[interaction.guild.id] = savedServers.filter(
    (server) => server.guildId !== selectedGuildId
  );

  saveData(data);

  await interaction.update({
    content: `Removed **${serverToRemove.name}** from this server's /send panel.`,
    embeds: [],
    components: []
  });
}

(async () => {
  try {
    await registerCommands();
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error("Bot startup failed:", error);
    process.exit(1);
  }
})();
