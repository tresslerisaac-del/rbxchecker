require("dotenv").config();

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

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
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  PermissionsBitField
} = require("discord.js");

const { DISCORD_TOKEN, CLIENT_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in Railway Variables.");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, "bot.sqlite");
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  theme_color INTEGER DEFAULT 5793266,
  post_channel_id TEXT,
  autopost_enabled INTEGER DEFAULT 0,
  autopost_hours INTEGER DEFAULT 24,
  last_autopost_at INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS panel_servers (
  host_guild_id TEXT NOT NULL,
  linked_guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  invite_url TEXT,
  category TEXT DEFAULT 'General',
  added_by TEXT,
  added_at TEXT,
  PRIMARY KEY (host_guild_id, linked_guild_id)
);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL
);
`);

const stmt = {
  getSettings: db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?"),
  insertSettings: db.prepare("INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)"),
  updateTheme: db.prepare("UPDATE guild_settings SET theme_color = ? WHERE guild_id = ?"),
  updateChannel: db.prepare("UPDATE guild_settings SET post_channel_id = ? WHERE guild_id = ?"),
  updateAutopost: db.prepare("UPDATE guild_settings SET autopost_enabled = ?, autopost_hours = ?, post_channel_id = COALESCE(?, post_channel_id) WHERE guild_id = ?"),
  updateLastAutopost: db.prepare("UPDATE guild_settings SET last_autopost_at = ? WHERE guild_id = ?"),
  listAutopost: db.prepare("SELECT * FROM guild_settings WHERE autopost_enabled = 1 AND post_channel_id IS NOT NULL"),

  upsertPanelServer: db.prepare(`
    INSERT INTO panel_servers
      (host_guild_id, linked_guild_id, name, description, icon_url, invite_url, category, added_by, added_at)
    VALUES
      (@host_guild_id, @linked_guild_id, @name, @description, @icon_url, @invite_url, @category, @added_by, @added_at)
    ON CONFLICT(host_guild_id, linked_guild_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      icon_url = excluded.icon_url,
      invite_url = excluded.invite_url,
      category = excluded.category,
      added_by = excluded.added_by,
      added_at = excluded.added_at
  `),

  listPanelServers: db.prepare("SELECT * FROM panel_servers WHERE host_guild_id = ? ORDER BY category COLLATE NOCASE, name COLLATE NOCASE"),
  findPanelServerById: db.prepare("SELECT * FROM panel_servers WHERE host_guild_id = ? AND linked_guild_id = ?"),
  deletePanelServer: db.prepare("DELETE FROM panel_servers WHERE host_guild_id = ? AND linked_guild_id = ?"),

  updatePanelServer: db.prepare(`
    UPDATE panel_servers
    SET name = COALESCE(?, name),
        description = COALESCE(?, description),
        category = COALESCE(?, category)
    WHERE host_guild_id = ? AND linked_guild_id = ?
  `),

  insertBackup: db.prepare("INSERT INTO backups (guild_id, name, created_by, created_at, json) VALUES (?, ?, ?, ?, ?)"),
  listBackups: db.prepare("SELECT id, name, created_by, created_at, json FROM backups WHERE guild_id = ? ORDER BY id DESC"),
  getBackup: db.prepare("SELECT * FROM backups WHERE id = ? AND guild_id = ?")
};

function ensureSettings(guildId) {
  stmt.insertSettings.run(guildId);
  return stmt.getSettings.get(guildId);
}

function parseHexColor(input) {
  const clean = input.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return parseInt(clean, 16);
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

function trimText(text, max = 1024) {
  if (!text || !String(text).trim()) return "No server description is set.";
  const value = String(text);
  return value.length <= max ? value : value.slice(0, max - 3) + "...";
}

function getGuildIcon(guildLike) {
  if (!guildLike || typeof guildLike.iconURL !== "function") return null;

  return guildLike.iconURL({
    size: 1024,
    extension: "png"
  });
}

function hasManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function requireManageGuild(interaction) {
  if (hasManageGuild(interaction)) return true;

  interaction.reply({
    content: "You need the **Manage Server** permission to use this command.",
    ephemeral: true
  });

  return false;
}

function chunkArray(array, size) {
  const chunks = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;
}

function backupCounts(snapshot) {
  return {
    roles: snapshot.roles?.length || 0,
    categories: snapshot.channels?.filter((c) => c.type === ChannelType.GuildCategory).length || 0,
    channels: snapshot.channels?.filter((c) => c.type !== ChannelType.GuildCategory).length || 0
  };
}

const commands = [
  new SlashCommandBuilder()
    .setName("send")
    .setDescription("Send the server information panel.")
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("preview")
    .setDescription("Preview the server panel privately.")
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("Show all servers saved in this server's panel.")
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("addserver")
    .setDescription("Add another server to this server's panel.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("invite")
        .setDescription("Discord server invite link or invite code.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("category")
        .setDescription("Optional category, like Gaming, Community, RP, etc.")
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("removeserver")
    .setDescription("Open a panel to remove saved servers.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("editserver")
    .setDescription("Edit a saved server's displayed name, description, or category.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("server")
        .setDescription("Saved server name or server ID.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("New display name.")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("New display description.")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("category")
        .setDescription("New category.")
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("settheme")
    .setDescription("Set this server panel's embed color.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("color")
        .setDescription("Hex color, example: #5865F2")
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set the channel where /send posts the panel.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Panel posting channel.")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("autopost")
    .setDescription("Automatically post the panel on a schedule.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((option) =>
      option
        .setName("enabled")
        .setDescription("Turn autopost on or off.")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("every_hours")
        .setDescription("How often to post. Default is 24 hours.")
        .setMinValue(1)
        .setMaxValue(168)
        .setRequired(false)
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Autopost channel.")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("save")
    .setDescription("Save this server's roles, channels, categories, and channel permissions.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Name this backup save.")
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("backup")
    .setDescription("View this server's backup saves and choose one to load.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
  startAutopostLoop();
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

      switch (interaction.commandName) {
        case "send":
          return handleSend(interaction);

        case "preview":
          return handlePreview(interaction);

        case "serverlist":
          return handleServerList(interaction);

        case "addserver":
          return handleAddServer(interaction);

        case "removeserver":
          return handleRemoveServerPanel(interaction);

        case "editserver":
          return handleEditServer(interaction);

        case "settheme":
          return handleSetTheme(interaction);

        case "setchannel":
          return handleSetChannel(interaction);

        case "autopost":
          return handleAutopost(interaction);

        case "save":
          return handleSave(interaction);

        case "backup":
          return handleBackupPanel(interaction);

        default:
          return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("remove-server:")) {
        return handleRemoveServerSelect(interaction);
      }

      if (interaction.customId.startsWith("backup-select:")) {
        return handleBackupSelect(interaction);
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("backup-load:")) {
        return handleBackupLoadConfirm(interaction);
      }

      if (interaction.customId === "backup-cancel") {
        return interaction.update({
          content: "Backup load cancelled.",
          embeds: [],
          components: []
        });
      }
    }
  } catch (error) {
    console.error(error);

    const payload = {
      content: "Something went wrong while running that command.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

async function buildPanelPayload(guild, ephemeralPreview = false) {
  const settings = ensureSettings(guild.id);
  const savedServers = stmt.listPanelServers.all(guild.id);

  const fetchedGuild = await guild.fetch();
  const icon = getGuildIcon(fetchedGuild);

  const embeds = [];

  const mainEmbed = new EmbedBuilder()
    .setColor(settings.theme_color || 0x5865f2)
    .setTitle("Server Panel")
    .addFields(
      {
        name: "Server Name",
        value: fetchedGuild.name,
        inline: false
      },
      {
        name: "Server Description",
        value: trimText(fetchedGuild.description),
        inline: false
      }
    )
    .setFooter({
      text: `Server ID: ${fetchedGuild.id}`
    })
    .setTimestamp();

  if (icon) {
    mainEmbed.setThumbnail(icon);
    mainEmbed.setImage(icon);
  }

  embeds.push(mainEmbed);

  for (const saved of savedServers.slice(0, 9)) {
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(saved.name || "Unknown Server")
      .addFields(
        {
          name: "Category",
          value: saved.category || "General",
          inline: true
        },
        {
          name: "Description",
          value: trimText(saved.description),
          inline: false
        }
      )
      .setFooter({
        text: `Server ID: ${saved.linked_guild_id}`
      });

    if (saved.icon_url) {
      embed.setThumbnail(saved.icon_url);
    }

    if (saved.invite_url) {
      embed.setURL(saved.invite_url);
    }

    embeds.push(embed);
  }

  if (savedServers.length > 9) {
    embeds[0].addFields({
      name: "More Servers",
      value: `Showing 9 of ${savedServers.length}. Use /serverlist to see the full list.`,
      inline: false
    });
  }

  if (ephemeralPreview) {
    embeds[0].setAuthor({
      name: "Private preview"
    });
  }

  const rows = [];

  const linkButtons = savedServers
    .filter((server) => server.invite_url)
    .slice(0, 25)
    .map((server) =>
      new ButtonBuilder()
        .setLabel(`Join ${server.name}`.slice(0, 80))
        .setStyle(ButtonStyle.Link)
        .setURL(server.invite_url)
    );

  for (const chunk of chunkArray(linkButtons, 5)) {
    rows.push(new ActionRowBuilder().addComponents(chunk));
  }

  return {
    embeds,
    components: rows
  };
}

async function handleSend(interaction) {
  const settings = ensureSettings(interaction.guild.id);
  const payload = await buildPanelPayload(interaction.guild, false);

  if (settings.post_channel_id) {
    const channel = await interaction.guild.channels.fetch(settings.post_channel_id).catch(() => null);

    if (channel && channel.isTextBased()) {
      await channel.send(payload);

      return interaction.reply({
        content: `Panel sent to ${channel}.`,
        ephemeral: true
      });
    }
  }

  return interaction.reply(payload);
}

async function handlePreview(interaction) {
  const payload = await buildPanelPayload(interaction.guild, true);

  return interaction.reply({
    ...payload,
    ephemeral: true
  });
}

async function handleServerList(interaction) {
  const servers = stmt.listPanelServers.all(interaction.guild.id);

  if (servers.length === 0) {
    return interaction.reply({
      content: "No servers have been added yet. Use `/addserver`.",
      ephemeral: true
    });
  }

  const lines = servers.map((server, index) => {
    const category = server.category || "General";
    const name = server.invite_url ? `[${server.name}](${server.invite_url})` : server.name;

    return `**${index + 1}.** ${name}
Category: ${category}
ID: \`${server.linked_guild_id}\``;
  });

  const embeds = [];
  let description = "";

  for (const line of lines) {
    if ((description + "\n\n" + line).length > 3900) {
      embeds.push(
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Saved Servers")
          .setDescription(description)
      );

      description = line;
    } else {
      description += description ? "\n\n" + line : line;
    }
  }

  if (description) {
    embeds.push(
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Saved Servers")
        .setDescription(description)
    );
  }

  return interaction.reply({
    embeds: embeds.slice(0, 10),
    ephemeral: true
  });
}

async function handleAddServer(interaction) {
  if (!requireManageGuild(interaction)) return;

  await interaction.deferReply({
    ephemeral: true
  });

  const inviteInput = interaction.options.getString("invite", true);
  const category = interaction.options.getString("category") || "General";
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

  const linkedGuildId = invite.guild.id;

  if (linkedGuildId === interaction.guild.id) {
    return interaction.editReply({
      content: "You cannot add this server because it is already the main server shown in `/send`."
    });
  }

  const existing = stmt.findPanelServerById.get(interaction.guild.id, linkedGuildId);

  const savedServer = {
    host_guild_id: interaction.guild.id,
    linked_guild_id: linkedGuildId,
    name: invite.guild.name || "Unknown Server",
    description: invite.guild.description || "No server description is set.",
    icon_url: getGuildIcon(invite.guild),
    invite_url: `https://discord.gg/${invite.code}`,
    category,
    added_by: interaction.user.id,
    added_at: new Date().toISOString()
  };

  stmt.upsertPanelServer.run(savedServer);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(existing ? "Server Updated" : "Server Added")
    .setDescription(`**${savedServer.name}** has been added to this server's /send panel.`)
    .addFields(
      {
        name: "Category",
        value: savedServer.category,
        inline: true
      },
      {
        name: "Description",
        value: trimText(savedServer.description),
        inline: false
      }
    );

  if (savedServer.icon_url) {
    embed.setThumbnail(savedServer.icon_url);
  }

  return interaction.editReply({
    embeds: [embed]
  });
}

async function handleRemoveServerPanel(interaction) {
  if (!requireManageGuild(interaction)) return;

  const servers = stmt.listPanelServers.all(interaction.guild.id)
    .filter((server) => server.linked_guild_id !== interaction.guild.id);

  if (servers.length === 0) {
    return interaction.reply({
      content: "There are no removable servers saved for this panel.",
      ephemeral: true
    });
  }

  const rows = [];
  const chunks = chunkArray(servers.slice(0, 125), 25);

  chunks.forEach((chunk, index) => {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`remove-server:${interaction.guild.id}:${index}`)
      .setPlaceholder(`Choose a server to remove ${chunks.length > 1 ? `(page ${index + 1})` : ""}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        chunk.map((server) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(server.name.slice(0, 100))
            .setDescription(`Category: ${server.category || "General"}`.slice(0, 100))
            .setValue(server.linked_guild_id)
        )
      );

    rows.push(new ActionRowBuilder().addComponents(menu));
  });

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Remove Server")
    .setDescription("Select a saved server from the dropdown below to remove it from `/send`. You cannot remove the current server from itself.");

  return interaction.reply({
    embeds: [embed],
    components: rows,
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

  if (!hasManageGuild(interaction)) {
    return interaction.reply({
      content: "You need **Manage Server** to remove saved servers.",
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

  const server = stmt.findPanelServerById.get(interaction.guild.id, selectedGuildId);

  if (!server) {
    return interaction.update({
      content: "That server is no longer saved.",
      embeds: [],
      components: []
    });
  }

  stmt.deletePanelServer.run(interaction.guild.id, selectedGuildId);

  return interaction.update({
    content: `Removed **${server.name}** from this server's /send panel.`,
    embeds: [],
    components: []
  });
}

async function handleEditServer(interaction) {
  if (!requireManageGuild(interaction)) return;

  const query = interaction.options.getString("server", true).toLowerCase();
  const name = interaction.options.getString("name");
  const description = interaction.options.getString("description");
  const category = interaction.options.getString("category");

  if (!name && !description && !category) {
    return interaction.reply({
      content: "Give me at least one thing to edit: `name`, `description`, or `category`.",
      ephemeral: true
    });
  }

  const servers = stmt.listPanelServers.all(interaction.guild.id);

  const server = servers.find((item) =>
    item.linked_guild_id === query || item.name.toLowerCase().includes(query)
  );

  if (!server) {
    return interaction.reply({
      content: "I couldn't find that saved server. Use `/serverlist` to see saved names and IDs.",
      ephemeral: true
    });
  }

  stmt.updatePanelServer.run(
    name,
    description,
    category,
    interaction.guild.id,
    server.linked_guild_id
  );

  return interaction.reply({
    content: `Updated **${name || server.name}** in this server's panel.`,
    ephemeral: true
  });
}

async function handleSetTheme(interaction) {
  if (!requireManageGuild(interaction)) return;

  const color = parseHexColor(interaction.options.getString("color", true));

  if (color === null) {
    return interaction.reply({
      content: "Use a valid hex color like `#5865F2`.",
      ephemeral: true
    });
  }

  ensureSettings(interaction.guild.id);
  stmt.updateTheme.run(color, interaction.guild.id);

  return interaction.reply({
    content: `Panel theme updated to \`#${color.toString(16).padStart(6, "0").toUpperCase()}\`.`,
    ephemeral: true
  });
}

async function handleSetChannel(interaction) {
  if (!requireManageGuild(interaction)) return;

  const channel = interaction.options.getChannel("channel", true);
  const me = await interaction.guild.members.fetchMe();
  const perms = channel.permissionsFor(me);

  if (!perms?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks
  ])) {
    return interaction.reply({
      content: `I need **View Channel**, **Send Messages**, and **Embed Links** in ${channel}.`,
      ephemeral: true
    });
  }

  ensureSettings(interaction.guild.id);
  stmt.updateChannel.run(channel.id, interaction.guild.id);

  return interaction.reply({
    content: `/send will now post the panel in ${channel}.`,
    ephemeral: true
  });
}

async function handleAutopost(interaction) {
  if (!requireManageGuild(interaction)) return;

  const enabled = interaction.options.getBoolean("enabled", true);
  const everyHours = interaction.options.getInteger("every_hours") || 24;
  const channel = interaction.options.getChannel("channel");
  const settings = ensureSettings(interaction.guild.id);

  if (enabled && !channel && !settings.post_channel_id) {
    return interaction.reply({
      content: "Choose a channel or run `/setchannel` before enabling autopost.",
      ephemeral: true
    });
  }

  if (channel) {
    const me = await interaction.guild.members.fetchMe();
    const perms = channel.permissionsFor(me);

    if (!perms?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks
    ])) {
      return interaction.reply({
        content: `I need **View Channel**, **Send Messages**, and **Embed Links** in ${channel}.`,
        ephemeral: true
      });
    }
  }

  ensureSettings(interaction.guild.id);

  stmt.updateAutopost.run(
    enabled ? 1 : 0,
    everyHours,
    channel?.id || null,
    interaction.guild.id
  );

  if (!enabled) {
    return interaction.reply({
      content: "Autopost is now off.",
      ephemeral: true
    });
  }

  return interaction.reply({
    content: `Autopost is now on every **${everyHours} hour(s)**${channel ? ` in ${channel}` : ""}.`,
    ephemeral: true
  });
}

async function handleSave(interaction) {
  if (!requireManageGuild(interaction)) return;

  await interaction.deferReply({
    ephemeral: true
  });

  const name = interaction.options.getString("name", true).slice(0, 100);
  const snapshot = await createBackupSnapshot(interaction.guild, interaction.user.id, name);
  const json = JSON.stringify(snapshot);

  const result = stmt.insertBackup.run(
    interaction.guild.id,
    name,
    interaction.user.id,
    new Date().toISOString(),
    json
  );

  const counts = backupCounts(snapshot);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Backup Saved")
    .setDescription(`Saved **${name}** as backup #${result.lastInsertRowid}.`)
    .addFields(
      {
        name: "Roles",
        value: String(counts.roles),
        inline: true
      },
      {
        name: "Categories",
        value: String(counts.categories),
        inline: true
      },
      {
        name: "Channels",
        value: String(counts.channels),
        inline: true
      }
    )
    .setFooter({
      text: "This does not save messages, members, boosts, ownership, or integrations."
    });

  return interaction.editReply({
    embeds: [embed]
  });
}

async function handleBackupPanel(interaction) {
  if (!requireManageGuild(interaction)) return;

  const backups = stmt.listBackups.all(interaction.guild.id);

  if (backups.length === 0) {
    return interaction.reply({
      content: "This server has no backups yet. Use `/save name:<name>` first.",
      ephemeral: true
    });
  }

  const rows = [];
  const chunks = chunkArray(backups.slice(0, 125), 25);

  chunks.forEach((chunk, index) => {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`backup-select:${interaction.guild.id}:${index}`)
      .setPlaceholder(`Choose a backup ${chunks.length > 1 ? `(page ${index + 1})` : ""}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        chunk.map((backup) => {
          let counts = {
            roles: "?",
            categories: "?",
            channels: "?"
          };

          try {
            counts = backupCounts(JSON.parse(backup.json));
          } catch {}

          return new StringSelectMenuOptionBuilder()
            .setLabel(`${backup.name}`.slice(0, 100))
            .setDescription(`Roles ${counts.roles} · Categories ${counts.categories} · Channels ${counts.channels}`.slice(0, 100))
            .setValue(String(backup.id));
        })
      );

    rows.push(new ActionRowBuilder().addComponents(menu));
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Server Backups")
    .setDescription("Choose a saved backup. After you choose one, you will get a confirmation button before it loads.");

  return interaction.reply({
    embeds: [embed],
    components: rows,
    ephemeral: true
  });
}

async function handleBackupSelect(interaction) {
  const guildIdFromMenu = interaction.customId.split(":")[1];

  if (!interaction.guild || interaction.guild.id !== guildIdFromMenu) {
    return interaction.reply({
      content: "This backup panel does not belong to this server.",
      ephemeral: true
    });
  }

  if (!hasManageGuild(interaction)) {
    return interaction.reply({
      content: "You need **Manage Server** to load backups.",
      ephemeral: true
    });
  }

  const backupId = Number(interaction.values[0]);
  const backup = stmt.getBackup.get(backupId, interaction.guild.id);

  if (!backup) {
    return interaction.update({
      content: "That backup no longer exists.",
      embeds: [],
      components: []
    });
  }

  let snapshot;

  try {
    snapshot = JSON.parse(backup.json);
  } catch {
    return interaction.update({
      content: "That backup data is corrupted and cannot be loaded.",
      embeds: [],
      components: []
    });
  }

  const counts = backupCounts(snapshot);

  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle(`Load Backup: ${backup.name}`)
    .setDescription("This will recreate/update saved roles, categories, channels, and channel role permission overwrites. It will **not** delete existing content.")
    .addFields(
      {
        name: "Roles",
        value: String(counts.roles),
        inline: true
      },
      {
        name: "Categories",
        value: String(counts.categories),
        inline: true
      },
      {
        name: "Channels",
        value: String(counts.channels),
        inline: true
      },
      {
        name: "Created",
        value: `<t:${Math.floor(new Date(backup.created_at).getTime() / 1000)}:F>`,
        inline: false
      }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`backup-load:${backup.id}:${interaction.user.id}`)
      .setLabel("Load This Backup")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("backup-cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.update({
    embeds: [embed],
    components: [row]
  });
}

async function handleBackupLoadConfirm(interaction) {
  const [, backupIdRaw, userId] = interaction.customId.split(":");

  if (interaction.user.id !== userId) {
    return interaction.reply({
      content: "Only the person who selected this backup can load it.",
      ephemeral: true
    });
  }

  if (!hasManageGuild(interaction)) {
    return interaction.reply({
      content: "You need **Manage Server** to load backups.",
      ephemeral: true
    });
  }

  await interaction.deferReply({
    ephemeral: true
  });

  const backupId = Number(backupIdRaw);
  const backup = stmt.getBackup.get(backupId, interaction.guild.id);

  if (!backup) {
    return interaction.editReply({
      content: "That backup no longer exists."
    });
  }

  let snapshot;

  try {
    snapshot = JSON.parse(backup.json);
  } catch {
    return interaction.editReply({
      content: "That backup data is corrupted and cannot be loaded."
    });
  }

  let result;

  try {
    result = await restoreBackupSnapshot(interaction.guild, snapshot);
  } catch (error) {
    console.error("Backup load failed:", error);

    return interaction.editReply({
      content: `Backup load failed: ${error.message}`
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Backup Load Complete")
    .setDescription(`Loaded **${backup.name}**.`)
    .addFields(
      {
        name: "Roles Created/Updated",
        value: `${result.rolesCreated}/${result.rolesUpdated}`,
        inline: true
      },
      {
        name: "Categories Created/Updated",
        value: `${result.categoriesCreated}/${result.categoriesUpdated}`,
        inline: true
      },
      {
        name: "Channels Created/Updated",
        value: `${result.channelsCreated}/${result.channelsUpdated}`,
        inline: true
      },
      {
        name: "Skipped/Failed",
        value: String(result.failed),
        inline: true
      }
    );

  return interaction.editReply({
    embeds: [embed]
  });
}

async function createBackupSnapshot(guild, userId, name) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id && !role.managed)
    .sort((a, b) => a.position - b.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.bitfield.toString(),
      position: role.position
    }));

  const supportedTypes = new Set([
    ChannelType.GuildCategory,
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
    ChannelType.GuildMedia
  ]);

  const channels = [...guild.channels.cache.values()]
    .filter((channel) => supportedTypes.has(channel.type))
    .sort((a, b) => a.position - b.position)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId || null,
      parentName: channel.parent?.name || null,
      position: channel.position || 0,
      topic: "topic" in channel ? channel.topic : null,
      nsfw: "nsfw" in channel ? channel.nsfw : false,
      rateLimitPerUser: "rateLimitPerUser" in channel ? channel.rateLimitPerUser : 0,
      bitrate: "bitrate" in channel ? channel.bitrate : null,
      userLimit: "userLimit" in channel ? channel.userLimit : null,
      permissionOverwrites: [...channel.permissionOverwrites.cache.values()]
        .filter((overwrite) => overwrite.type === 0 || overwrite.id === guild.id)
        .map((overwrite) => ({
          id: overwrite.id,
          type: overwrite.type,
          allow: overwrite.allow.bitfield.toString(),
          deny: overwrite.deny.bitfield.toString()
        }))
    }));

  return {
    version: 1,
    guildId: guild.id,
    guildName: guild.name,
    savedBy: userId,
    saveName: name,
    savedAt: new Date().toISOString(),
    roles,
    channels
  };
}

function mapPermissionOverwrites(overwrites, guild, roleIdMap) {
  const mapped = [];

  for (const overwrite of overwrites || []) {
    if (overwrite.type !== 0 && overwrite.id !== guild.id) continue;

    let id;

    if (overwrite.id === guild.id) {
      id = guild.id;
    } else {
      id = roleIdMap.get(overwrite.id);
    }

    if (!id) continue;

    mapped.push({
      id,
      type: 0,
      allow: new PermissionsBitField(BigInt(overwrite.allow || "0")),
      deny: new PermissionsBitField(BigInt(overwrite.deny || "0"))
    });
  }

  return mapped;
}

function channelCreateOptions(channelData, parentId, overwrites) {
  const base = {
    name: channelData.name,
    type: channelData.type,
    parent: parentId || undefined,
    permissionOverwrites: overwrites,
    reason: "Loading server backup"
  };

  if ([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum,
    ChannelType.GuildMedia
  ].includes(channelData.type)) {
    base.topic = channelData.topic || undefined;
    base.nsfw = Boolean(channelData.nsfw);
    base.rateLimitPerUser = channelData.rateLimitPerUser || 0;
  }

  if ([
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice
  ].includes(channelData.type)) {
    if (channelData.bitrate) {
      base.bitrate = channelData.bitrate;
    }

    if (channelData.userLimit !== null && channelData.userLimit !== undefined) {
      base.userLimit = channelData.userLimit;
    }
  }

  return base;
}

async function restoreBackupSnapshot(guild, snapshot) {
  const me = await guild.members.fetchMe();

  const needed = [
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels
  ];

  if (!me.permissions.has(needed)) {
    throw new Error("Bot needs Manage Roles and Manage Channels to load backups.");
  }

  await guild.roles.fetch();
  await guild.channels.fetch();

  const roleIdMap = new Map();
  const categoryIdMap = new Map();

  const result = {
    rolesCreated: 0,
    rolesUpdated: 0,
    categoriesCreated: 0,
    categoriesUpdated: 0,
    channelsCreated: 0,
    channelsUpdated: 0,
    failed: 0
  };

  const roles = [...(snapshot.roles || [])].sort((a, b) => a.position - b.position);

  for (const roleData of roles) {
    try {
      let role = guild.roles.cache.find((r) => !r.managed && r.name === roleData.name);
      const editable = role ? role.editable : true;

      if (!role) {
        role = await guild.roles.create({
          name: roleData.name,
          color: roleData.color || 0,
          hoist: Boolean(roleData.hoist),
          mentionable: Boolean(roleData.mentionable),
          permissions: BigInt(roleData.permissions || "0"),
          reason: "Loading server backup"
        });

        result.rolesCreated++;
      } else if (editable) {
        await role.edit({
          color: roleData.color || 0,
          hoist: Boolean(roleData.hoist),
          mentionable: Boolean(roleData.mentionable),
          permissions: BigInt(roleData.permissions || "0"),
          reason: "Loading server backup"
        });

        result.rolesUpdated++;
      }

      if (role) {
        roleIdMap.set(roleData.id, role.id);
        await role.setPosition(roleData.position).catch(() => {});
      }
    } catch (error) {
      console.error("Role restore failed:", roleData.name, error.message);
      result.failed++;
    }
  }

  await guild.channels.fetch();

  const categories = (snapshot.channels || []).filter((c) => c.type === ChannelType.GuildCategory);

  for (const categoryData of categories) {
    try {
      const overwrites = mapPermissionOverwrites(
        categoryData.permissionOverwrites,
        guild,
        roleIdMap
      );

      let category = guild.channels.cache.find((c) =>
        c.type === ChannelType.GuildCategory && c.name === categoryData.name
      );

      if (!category) {
        category = await guild.channels.create(
          channelCreateOptions(categoryData, null, overwrites)
        );

        result.categoriesCreated++;
      } else {
        await category.edit({
          permissionOverwrites: overwrites,
          reason: "Loading server backup"
        }).catch(() => {});

        result.categoriesUpdated++;
      }

      categoryIdMap.set(categoryData.id, category.id);
      await category.setPosition(categoryData.position).catch(() => {});
    } catch (error) {
      console.error("Category restore failed:", categoryData.name, error.message);
      result.failed++;
    }
  }

  await guild.channels.fetch();

  const normalChannels = (snapshot.channels || []).filter((c) => c.type !== ChannelType.GuildCategory);

  for (const channelData of normalChannels) {
    try {
      const parentId = channelData.parentId ? categoryIdMap.get(channelData.parentId) : null;

      const overwrites = mapPermissionOverwrites(
        channelData.permissionOverwrites,
        guild,
        roleIdMap
      );

      let channel = guild.channels.cache.find((c) =>
        c.type === channelData.type &&
        c.name === channelData.name &&
        (
          (c.parentId || null) === (parentId || null) ||
          c.parent?.name === channelData.parentName
        )
      );

      if (!channel) {
        channel = await guild.channels.create(
          channelCreateOptions(channelData, parentId, overwrites)
        );

        result.channelsCreated++;
      } else {
        const editOptions = channelCreateOptions(channelData, parentId, overwrites);

        delete editOptions.type;
        delete editOptions.name;

        await channel.edit(editOptions).catch(() => {});
        result.channelsUpdated++;
      }

      await channel.setPosition(channelData.position).catch(() => {});
    } catch (error) {
      console.error("Channel restore failed:", channelData.name, error.message);
      result.failed++;
    }
  }

  return result;
}

function startAutopostLoop() {
  setInterval(performAutoposts, 60 * 1000);
  performAutoposts().catch(console.error);
}

async function performAutoposts() {
  const now = Date.now();
  const settingsList = stmt.listAutopost.all();

  for (const settings of settingsList) {
    const everyMs = Math.max(1, settings.autopost_hours || 24) * 60 * 60 * 1000;

    if (settings.last_autopost_at && now - settings.last_autopost_at < everyMs) {
      continue;
    }

    try {
      const guild = await client.guilds.fetch(settings.guild_id).catch(() => null);
      if (!guild) continue;

      const channel = await guild.channels.fetch(settings.post_channel_id).catch(() => null);
      if (!channel || !channel.isTextBased()) continue;

      const payload = await buildPanelPayload(guild, false);

      await channel.send(payload);

      stmt.updateLastAutopost.run(now, settings.guild_id);
    } catch (error) {
      console.error("Autopost failed:", settings.guild_id, error.message);
    }
  }
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
