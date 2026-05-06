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
  ChannelSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  PermissionsBitField,
  AttachmentBuilder
} = require("discord.js");

const { DISCORD_TOKEN, CLIENT_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  throw new Error("Missing DISCORD_TOKEN or CLIENT_ID in Railway Variables.");
}

const DATA_DIR =
  process.env.DATA_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  __dirname;

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "bot.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT PRIMARY KEY,
  theme INTEGER DEFAULT 5793266,
  panel_channel TEXT,
  log_channel TEXT,
  autopost INTEGER DEFAULT 0,
  autopost_hours INTEGER DEFAULT 24,
  last_autopost INTEGER DEFAULT 0,
  autosave INTEGER DEFAULT 0,
  autosave_hours INTEGER DEFAULT 24,
  last_autosave INTEGER DEFAULT 0,
  max_saves INTEGER DEFAULT 10
);

CREATE TABLE IF NOT EXISTS panel_servers (
  host_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  invite TEXT,
  category TEXT DEFAULT 'General',
  added_by TEXT,
  added_at TEXT,
  PRIMARY KEY(host_id, server_id)
);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT,
  data TEXT NOT NULL
);
`);

function addColumnIfMissing(table, column, definition) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((item) => item.name);

  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

for (const [column, definition] of [
  ["log_channel", "log_channel TEXT"],
  ["autosave", "autosave INTEGER DEFAULT 0"],
  ["autosave_hours", "autosave_hours INTEGER DEFAULT 24"],
  ["last_autosave", "last_autosave INTEGER DEFAULT 0"],
  ["max_saves", "max_saves INTEGER DEFAULT 10"]
]) {
  addColumnIfMissing("settings", column, definition);
}

const sql = {
  ensureSettings: db.prepare("INSERT OR IGNORE INTO settings(guild_id) VALUES(?)"),
  getSettings: db.prepare("SELECT * FROM settings WHERE guild_id = ?"),
  setTheme: db.prepare("UPDATE settings SET theme = ? WHERE guild_id = ?"),
  setPanelChannel: db.prepare("UPDATE settings SET panel_channel = ? WHERE guild_id = ?"),
  setLogChannel: db.prepare("UPDATE settings SET log_channel = ? WHERE guild_id = ?"),
  setAutopost: db.prepare(`
    UPDATE settings
    SET autopost = ?, autopost_hours = ?, panel_channel = COALESCE(?, panel_channel)
    WHERE guild_id = ?
  `),
  setAutosave: db.prepare(`
    UPDATE settings
    SET autosave = ?, autosave_hours = ?
    WHERE guild_id = ?
  `),
  setMaxSaves: db.prepare("UPDATE settings SET max_saves = ? WHERE guild_id = ?"),
  setLastAutopost: db.prepare("UPDATE settings SET last_autopost = ? WHERE guild_id = ?"),
  setLastAutosave: db.prepare("UPDATE settings SET last_autosave = ? WHERE guild_id = ?"),
  listAutoposts: db.prepare(`
    SELECT * FROM settings
    WHERE autopost = 1 AND panel_channel IS NOT NULL
  `),
  listAutosaves: db.prepare(`
    SELECT * FROM settings
    WHERE autosave = 1
  `),

  upsertPanelServer: db.prepare(`
    INSERT INTO panel_servers (
      host_id,
      server_id,
      name,
      description,
      icon,
      invite,
      category,
      added_by,
      added_at
    )
    VALUES (
      @host_id,
      @server_id,
      @name,
      @description,
      @icon,
      @invite,
      @category,
      @added_by,
      @added_at
    )
    ON CONFLICT(host_id, server_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      icon = excluded.icon,
      invite = excluded.invite,
      category = excluded.category,
      added_by = excluded.added_by,
      added_at = excluded.added_at
  `),
  listPanelServers: db.prepare(`
    SELECT * FROM panel_servers
    WHERE host_id = ?
    ORDER BY category COLLATE NOCASE, name COLLATE NOCASE
  `),
  getPanelServer: db.prepare(`
    SELECT * FROM panel_servers
    WHERE host_id = ? AND server_id = ?
  `),
  deletePanelServer: db.prepare(`
    DELETE FROM panel_servers
    WHERE host_id = ? AND server_id = ?
  `),
  editPanelServer: db.prepare(`
    UPDATE panel_servers
    SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      category = COALESCE(?, category)
    WHERE host_id = ? AND server_id = ?
  `),

  addBackup: db.prepare(`
    INSERT INTO backups (
      guild_id,
      name,
      created_by,
      created_at,
      data
    )
    VALUES (?, ?, ?, ?, ?)
  `),
  listBackups: db.prepare(`
    SELECT * FROM backups
    WHERE guild_id = ?
    ORDER BY id DESC
  `),
  getBackup: db.prepare(`
    SELECT * FROM backups
    WHERE guild_id = ? AND id = ?
  `),
  deleteBackup: db.prepare(`
    DELETE FROM backups
    WHERE guild_id = ? AND id = ?
  `),

  countServers: db.prepare(`
    SELECT COUNT(*) AS count FROM panel_servers
    WHERE host_id = ?
  `),
  countBackups: db.prepare(`
    SELECT COUNT(*) AS count FROM backups
    WHERE guild_id = ?
  `)
};

function getSettings(guildId) {
  sql.ensureSettings.run(guildId);
  return sql.getSettings.get(guildId);
}

function hasManageServer(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function trimText(value, max = 1024) {
  if (!value) return "No server description is set.";

  const text = String(value);

  if (text.length <= max) return text;

  return text.slice(0, max - 3) + "...";
}

function getGuildIcon(guild) {
  return (
    guild?.iconURL?.({
      size: 1024,
      extension: "png"
    }) || null
  );
}

function parseHexColor(input) {
  if (!/^#?[0-9a-f]{6}$/i.test(input)) return null;
  return parseInt(input.replace("#", ""), 16);
}

function cleanInvite(input) {
  return input
    .trim()
    .replace(/^https?:\/\/(discord\.gg|discord\.com\/invite)\//, "")
    .split(/[/?]/)[0];
}

function safeFileName(input) {
  return String(input || "backup")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "backup";
}

function chunkArray(array, size) {
  return Array.from(
    { length: Math.ceil(array.length / size) },
    (_, index) => array.slice(index * size, index * size + size)
  );
}

function backupCounts(snapshot) {
  return {
    roles: snapshot.roles?.length || 0,
    categories:
      snapshot.channels?.filter((channel) => channel.type === ChannelType.GuildCategory).length || 0,
    channels:
      snapshot.channels?.filter((channel) => channel.type !== ChannelType.GuildCategory).length || 0
  };
}

function isValidSnapshot(snapshot) {
  return snapshot && Array.isArray(snapshot.roles) && Array.isArray(snapshot.channels);
}

async function logAction(guild, title, description, color = 0x5865f2) {
  const settings = getSettings(guild.id);

  if (!settings.log_channel) return;

  const channel = await guild.channels.fetch(settings.log_channel).catch(() => null);

  if (!channel?.isTextBased()) return;

  await channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setTitle(title)
          .setDescription(description)
          .setTimestamp()
      ]
    })
    .catch(() => {});
}

async function botCanPost(guild, channel) {
  const me = await guild.members.fetchMe();

  return channel.permissionsFor(me)?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks
  ]);
}

function findBackup(guildId, input = "") {
  const backups = sql.listBackups.all(guildId);

  if (!input.trim()) return backups[0] || null;

  const id = Number(input);

  if (Number.isInteger(id)) {
    return backups.find((backup) => backup.id === id) || null;
  }

  const query = input.toLowerCase();

  return (
    backups.find((backup) => backup.name.toLowerCase() === query) ||
    backups.find((backup) => backup.name.toLowerCase().includes(query)) ||
    null
  );
}

function enforceBackupLimit(guildId) {
  const settings = getSettings(guildId);
  const maxSaves = settings.max_saves || 10;
  const backups = sql.listBackups.all(guildId);
  const oldBackups = backups.slice(maxSaves);

  for (const backup of oldBackups) {
    sql.deleteBackup.run(guildId, backup.id);
  }

  return oldBackups.length;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const adminCommand = (command) =>
  command
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const guildCommand = (command) =>
  command.setDMPermission(false);

const commands = [
  guildCommand(
    new SlashCommandBuilder()
      .setName("send")
      .setDescription("Send the server panel.")
  ),

  guildCommand(
    new SlashCommandBuilder()
      .setName("preview")
      .setDescription("Preview the server panel privately.")
  ),

  guildCommand(
    new SlashCommandBuilder()
      .setName("serverlist")
      .setDescription("Show saved panel servers.")
  ),

  guildCommand(
    new SlashCommandBuilder()
      .setName("config")
      .setDescription("Show bot settings for this server.")
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Open a quick setup panel.")
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("addserver")
      .setDescription("Add a server to /send.")
      .addStringOption((option) =>
        option
          .setName("invite")
          .setDescription("Invite link or invite code.")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("category")
          .setDescription("Category, like Gaming, Community, RP, etc.")
          .setRequired(false)
      )
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("removeserver")
      .setDescription("Remove a saved server with a dropdown.")
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("editserver")
      .setDescription("Edit a saved server.")
      .addStringOption((option) =>
        option
          .setName("server")
          .setDescription("Saved server name or ID.")
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
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("settheme")
      .setDescription("Set embed color.")
      .addStringOption((option) =>
        option
          .setName("color")
          .setDescription("Hex color, example: #5865F2")
          .setRequired(true)
      )
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("setchannel")
      .setDescription("Set panel channel.")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Panel channel.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("setlogchannel")
      .setDescription("Set log channel.")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Log channel.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("autopost")
      .setDescription("Post panel on a schedule.")
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Turn autopost on or off.")
          .setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("every_hours")
          .setDescription("How often to post. 1 to 168 hours.")
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
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("autosave")
      .setDescription("Save backups automatically.")
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Turn autosave on or off.")
          .setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("every_hours")
          .setDescription("How often to autosave. 1 to 168 hours.")
          .setMinValue(1)
          .setMaxValue(168)
          .setRequired(false)
      )
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("backupsettings")
      .setDescription("Set max backup saves.")
      .addIntegerOption((option) =>
        option
          .setName("max_saves")
          .setDescription("Maximum backup saves. 1 to 100.")
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(true)
      )
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("save")
      .setDescription("Save roles, channels, categories, and permissions.")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Backup name.")
          .setRequired(true)
      )
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("backup")
      .setDescription("Show backups and load one.")
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("restorepreview")
      .setDescription("Preview a backup restore.")
      .addStringOption((option) =>
        option
          .setName("backup")
          .setDescription("Backup name or ID.")
          .setRequired(true)
      )
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("deletebackup")
      .setDescription("Delete backups with a dropdown.")
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("exportbackup")
      .setDescription("Export a backup JSON.")
      .addStringOption((option) =>
        option
          .setName("backup")
          .setDescription("Backup name or ID. Blank exports latest.")
          .setRequired(false)
      )
  ),

  adminCommand(
    new SlashCommandBuilder()
      .setName("importbackup")
      .setDescription("Import backup JSON.")
      .addAttachmentOption((option) =>
        option
          .setName("file")
          .setDescription("Backup JSON file.")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Optional imported backup name.")
          .setRequired(false)
      )
  )
].map((command) => command.toJSON());

async function buildPanelPayload(guild, preview = false) {
  const settings = getSettings(guild.id);
  const fetchedGuild = await guild.fetch();
  const savedServers = sql.listPanelServers.all(guild.id);

  const embeds = [];

  const mainEmbed = new EmbedBuilder()
    .setColor(settings.theme)
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

  if (preview) {
    mainEmbed.setAuthor({
      name: "Private preview"
    });
  }

  const serverIcon = getGuildIcon(fetchedGuild);

  if (serverIcon) {
    mainEmbed.setThumbnail(serverIcon);
    mainEmbed.setImage(serverIcon);
  }

  embeds.push(mainEmbed);

  const groupedServers = new Map();

  for (const server of savedServers) {
    const category = server.category || "General";

    if (!groupedServers.has(category)) {
      groupedServers.set(category, []);
    }

    groupedServers.get(category).push(server);
  }

  let description = "";

  for (const [category, servers] of groupedServers) {
    const block =
      `\n\n**${category}**\n` +
      servers
        .map((server) => {
          const name = server.invite
            ? `[${server.name}](${server.invite})`
            : server.name;

          return `• ${name} — ${trimText(server.description, 120)}`;
        })
        .join("\n");

    if ((description + block).length > 3800) {
      embeds.push(
        new EmbedBuilder()
          .setColor(settings.theme)
          .setTitle("Added Servers")
          .setDescription(description.trim())
      );

      description = block;
    } else {
      description += block;
    }
  }

  if (description) {
    embeds.push(
      new EmbedBuilder()
        .setColor(settings.theme)
        .setTitle("Added Servers")
        .setDescription(description.trim())
    );
  } else {
    mainEmbed.addFields({
      name: "Added Servers",
      value: "None yet. Use `/addserver`.",
      inline: false
    });
  }

  const buttons = savedServers
    .filter((server) => server.invite)
    .slice(0, 25)
    .map((server) =>
      new ButtonBuilder()
        .setLabel(`Join ${server.name}`.slice(0, 80))
        .setStyle(ButtonStyle.Link)
        .setURL(server.invite)
    );

  const rows = chunkArray(buttons, 5)
    .slice(0, 5)
    .map((chunk) => new ActionRowBuilder().addComponents(chunk));

  return {
    embeds: embeds.slice(0, 10),
    components: rows
  };
}

function buildConfigEmbed(guild) {
  const settings = getSettings(guild.id);

  return new EmbedBuilder()
    .setColor(settings.theme)
    .setTitle("Bot Config")
    .addFields(
      {
        name: "Panel Channel",
        value: settings.panel_channel ? `<#${settings.panel_channel}>` : "Not set",
        inline: true
      },
      {
        name: "Log Channel",
        value: settings.log_channel ? `<#${settings.log_channel}>` : "Not set",
        inline: true
      },
      {
        name: "Theme",
        value: `#${Number(settings.theme).toString(16).padStart(6, "0").toUpperCase()}`,
        inline: true
      },
      {
        name: "Autopost",
        value: settings.autopost ? `On / every ${settings.autopost_hours}h` : "Off",
        inline: true
      },
      {
        name: "Autosave",
        value: settings.autosave ? `On / every ${settings.autosave_hours}h` : "Off",
        inline: true
      },
      {
        name: "Max Saves",
        value: String(settings.max_saves),
        inline: true
      },
      {
        name: "Saved Servers",
        value: String(sql.countServers.get(guild.id).count),
        inline: true
      },
      {
        name: "Backups",
        value: String(sql.countBackups.get(guild.id).count),
        inline: true
      }
    );
}

function buildBackupSelectRows(guildId, prefix) {
  const rows = [];
  const backups = sql.listBackups.all(guildId).slice(0, 125);

  for (const [index, part] of chunkArray(backups, 25).entries()) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${prefix}:${guildId}:${index}`)
      .setPlaceholder("Choose a backup")
      .addOptions(
        part.map((backup) => {
          let counts = {
            roles: "?",
            categories: "?",
            channels: "?"
          };

          try {
            counts = backupCounts(JSON.parse(backup.data));
          } catch {}

          return new StringSelectMenuOptionBuilder()
            .setLabel(backup.name.slice(0, 100))
            .setDescription(
              `ID ${backup.id} • Roles ${counts.roles} • Categories ${counts.categories} • Channels ${counts.channels}`.slice(0, 100)
            )
            .setValue(String(backup.id));
        })
      );

    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  return rows.slice(0, 5);
}

async function createSnapshot(guild, userId, name) {
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

  const allowedChannelTypes = new Set([
    ChannelType.GuildCategory,
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum
  ]);

  const channels = [...guild.channels.cache.values()]
    .filter((channel) => allowedChannelTypes.has(channel.type))
    .sort((a, b) => a.position - b.position)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId,
      parentName: channel.parent?.name || null,
      position: channel.position || 0,
      topic: "topic" in channel ? channel.topic : null,
      nsfw: "nsfw" in channel ? channel.nsfw : false,
      rateLimitPerUser: "rateLimitPerUser" in channel ? channel.rateLimitPerUser : 0,
      bitrate: "bitrate" in channel ? channel.bitrate : null,
      userLimit: "userLimit" in channel ? channel.userLimit : null,
      overwrites: [...channel.permissionOverwrites.cache.values()]
        .filter((overwrite) => overwrite.type === 0 || overwrite.id === guild.id)
        .map((overwrite) => ({
          id: overwrite.id,
          type: overwrite.type,
          allow: overwrite.allow.bitfield.toString(),
          deny: overwrite.deny.bitfield.toString()
        }))
    }));

  return {
    version: 3,
    guildId: guild.id,
    guildName: guild.name,
    saveName: name,
    savedBy: userId,
    savedAt: new Date().toISOString(),
    roles,
    channels
  };
}

async function compareSnapshot(guild, snapshot) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const result = {
    rolesCreate: 0,
    rolesUpdate: 0,
    rolesSkip: 0,
    categoriesCreate: 0,
    categoriesUpdate: 0,
    channelsCreate: 0,
    channelsUpdate: 0,
    channelsSkip: 0
  };

  for (const roleData of snapshot.roles) {
    const existing = guild.roles.cache.find(
      (role) => !role.managed && role.name === roleData.name
    );

    if (!existing) {
      result.rolesCreate++;
    } else if (existing.editable) {
      result.rolesUpdate++;
    } else {
      result.rolesSkip++;
    }
  }

  for (const channelData of snapshot.channels.filter(
    (channel) => channel.type === ChannelType.GuildCategory
  )) {
    const existing = guild.channels.cache.find(
      (channel) => channel.type === channelData.type && channel.name === channelData.name
    );

    if (existing) {
      result.categoriesUpdate++;
    } else {
      result.categoriesCreate++;
    }
  }

  for (const channelData of snapshot.channels.filter(
    (channel) => channel.type !== ChannelType.GuildCategory
  )) {
    const existing = guild.channels.cache.find(
      (channel) =>
        channel.type === channelData.type &&
        channel.name === channelData.name &&
        (channel.parent?.name || null) === (channelData.parentName || null)
    );

    if (existing) {
      result.channelsUpdate++;
    } else {
      result.channelsCreate++;
    }
  }

  return result;
}

function buildRestorePreviewEmbed(backup, snapshot, preview) {
  const counts = backupCounts(snapshot);

  return new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle(`Restore Preview: ${backup.name}`)
    .addFields(
      {
        name: "Saved",
        value: `Roles: **${counts.roles}**\nCategories: **${counts.categories}**\nChannels: **${counts.channels}**`,
        inline: true
      },
      {
        name: "Will Create",
        value: `Roles: **${preview.rolesCreate}**\nCategories: **${preview.categoriesCreate}**\nChannels: **${preview.channelsCreate}**`,
        inline: true
      },
      {
        name: "Will Update",
        value: `Roles: **${preview.rolesUpdate}**\nCategories: **${preview.categoriesUpdate}**\nChannels: **${preview.channelsUpdate}**`,
        inline: true
      },
      {
        name: "Will Skip",
        value: `Roles: **${preview.rolesSkip}**\nChannels: **${preview.channelsSkip}**`,
        inline: true
      }
    )
    .setFooter({
      text: "Restore is additive. It does not delete existing roles/channels/messages."
    });
}

function mapPermissionOverwrites(overwrites, guild, roleMap) {
  return (overwrites || [])
    .map((overwrite) => {
      const id =
        overwrite.id === guild.id
          ? guild.id
          : roleMap.get(overwrite.id);

      if (!id || (overwrite.type !== 0 && overwrite.id !== guild.id)) {
        return null;
      }

      return {
        id,
        type: 0,
        allow: new PermissionsBitField(BigInt(overwrite.allow || "0")),
        deny: new PermissionsBitField(BigInt(overwrite.deny || "0"))
      };
    })
    .filter(Boolean);
}

function channelCreateOptions(channelData, parentId, overwrites) {
  const options = {
    name: channelData.name,
    type: channelData.type,
    parent: parentId || undefined,
    permissionOverwrites: overwrites,
    reason: "Backup restore"
  };

  if (
    [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.GuildForum
    ].includes(channelData.type)
  ) {
    options.topic = channelData.topic || undefined;
    options.nsfw = Boolean(channelData.nsfw);
    options.rateLimitPerUser = channelData.rateLimitPerUser || 0;
  }

  if (
    [
      ChannelType.GuildVoice,
      ChannelType.GuildStageVoice
    ].includes(channelData.type)
  ) {
    options.bitrate = channelData.bitrate || undefined;
    options.userLimit = channelData.userLimit ?? undefined;
  }

  return options;
}

async function restoreSnapshot(guild, snapshot) {
  const me = await guild.members.fetchMe();

  if (
    !me.permissions.has([
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageChannels
    ])
  ) {
    throw new Error("Bot needs Manage Roles and Manage Channels.");
  }

  await guild.roles.fetch();
  await guild.channels.fetch();

  const roleMap = new Map();
  const categoryMap = new Map();

  const result = {
    rolesCreated: 0,
    rolesUpdated: 0,
    categoriesCreated: 0,
    categoriesUpdated: 0,
    channelsCreated: 0,
    channelsUpdated: 0,
    skipped: 0,
    failed: 0
  };

  const roles = [...snapshot.roles].sort((a, b) => a.position - b.position);

  for (const roleData of roles) {
    try {
      let role = guild.roles.cache.find(
        (item) => !item.managed && item.name === roleData.name
      );

      if (!role) {
        role = await guild.roles.create({
          name: roleData.name,
          color: roleData.color || 0,
          hoist: Boolean(roleData.hoist),
          mentionable: Boolean(roleData.mentionable),
          permissions: BigInt(roleData.permissions || "0"),
          reason: "Backup restore"
        });

        result.rolesCreated++;
      } else if (role.editable) {
        await role.edit({
          color: roleData.color || 0,
          hoist: Boolean(roleData.hoist),
          mentionable: Boolean(roleData.mentionable),
          permissions: BigInt(roleData.permissions || "0"),
          reason: "Backup restore"
        });

        result.rolesUpdated++;
      } else {
        result.skipped++;
      }

      if (role) {
        roleMap.set(roleData.id, role.id);
        await role.setPosition(roleData.position).catch(() => {});
      }
    } catch (error) {
      console.error("Role restore failed:", error);
      result.failed++;
    }
  }

  const categories = snapshot.channels.filter(
    (channel) => channel.type === ChannelType.GuildCategory
  );

  for (const channelData of categories) {
    try {
      const overwrites = mapPermissionOverwrites(
        channelData.overwrites,
        guild,
        roleMap
      );

      let category = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildCategory &&
          channel.name === channelData.name
      );

      if (!category) {
        category = await guild.channels.create(
          channelCreateOptions(channelData, null, overwrites)
        );

        result.categoriesCreated++;
      } else {
        await category
          .edit({
            permissionOverwrites: overwrites,
            reason: "Backup restore"
          })
          .catch(() => {});

        result.categoriesUpdated++;
      }

      categoryMap.set(channelData.id, category.id);
      await category.setPosition(channelData.position).catch(() => {});
    } catch (error) {
      console.error("Category restore failed:", error);
      result.failed++;
    }
  }

  await guild.channels.fetch();

  const normalChannels = snapshot.channels.filter(
    (channel) => channel.type !== ChannelType.GuildCategory
  );

  for (const channelData of normalChannels) {
    try {
      const parentId = channelData.parentId
        ? categoryMap.get(channelData.parentId)
        : null;

      const overwrites = mapPermissionOverwrites(
        channelData.overwrites,
        guild,
        roleMap
      );

      let channel = guild.channels.cache.find(
        (item) =>
          item.type === channelData.type &&
          item.name === channelData.name &&
          (
            (item.parentId || null) === (parentId || null) ||
            item.parent?.name === channelData.parentName
          )
      );

      if (!channel) {
        channel = await guild.channels.create(
          channelCreateOptions(channelData, parentId, overwrites)
        );

        result.channelsCreated++;
      } else {
        const options = channelCreateOptions(channelData, parentId, overwrites);

        delete options.name;
        delete options.type;

        await channel.edit(options).catch(() => {});
        result.channelsUpdated++;
      }

      await channel.setPosition(channelData.position).catch(() => {});
    } catch (error) {
      console.error("Channel restore failed:", error);
      result.failed++;
    }
  }

  return result;
}

async function handleSend(interaction) {
  const settings = getSettings(interaction.guild.id);
  const payload = await buildPanelPayload(interaction.guild);

  if (settings.panel_channel) {
    const channel = await interaction.guild.channels.fetch(settings.panel_channel).catch(() => null);

    if (channel?.isTextBased()) {
      await channel.send(payload);

      return interaction.reply({
        content: `Panel sent to ${channel}.`,
        ephemeral: true
      });
    }
  }

  return interaction.reply(payload);
}

async function handleServerList(interaction) {
  const servers = sql.listPanelServers.all(interaction.guild.id);

  if (!servers.length) {
    return interaction.reply({
      content: "No servers saved yet.",
      ephemeral: true
    });
  }

  const description = servers
    .map((server, index) => {
      const name = server.invite
        ? `[${server.name}](${server.invite})`
        : server.name;

      return `**${index + 1}.** ${name}\nCategory: ${server.category || "General"}\nID: \`${server.server_id}\``;
    })
    .join("\n\n")
    .slice(0, 3900);

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(getSettings(interaction.guild.id).theme)
        .setTitle("Saved Servers")
        .setDescription(description)
    ],
    ephemeral: true
  });
}

async function handleSetup(interaction) {
  const embed = new EmbedBuilder()
    .setColor(getSettings(interaction.guild.id).theme)
    .setTitle("Setup Panel")
    .setDescription("Use the buttons and menus below. Use slash commands for addserver, backups, and theme.");

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup-preview:${interaction.guild.id}`)
      .setLabel("Preview")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`setup-config:${interaction.guild.id}`)
      .setLabel("Config")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`setup-autopost:${interaction.guild.id}`)
      .setLabel("Toggle Autopost")
      .setStyle(ButtonStyle.Success)
  );

  const panelChannelRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`setup-panel:${interaction.guild.id}`)
      .setPlaceholder("Set panel channel")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

  const logChannelRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`setup-log:${interaction.guild.id}`)
      .setPlaceholder("Set log channel")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

  return interaction.reply({
    embeds: [embed],
    components: [buttonRow, panelChannelRow, logChannelRow],
    ephemeral: true
  });
}

async function handleAddServer(interaction) {
  await interaction.deferReply({
    ephemeral: true
  });

  const inviteInput = interaction.options.getString("invite", true);
  const inviteCode = cleanInvite(inviteInput);

  const invite = await client.fetchInvite(inviteCode).catch(() => null);

  if (!invite?.guild) {
    return interaction.editReply("Invalid/expired invite or I cannot fetch it.");
  }

  if (invite.guild.id === interaction.guild.id) {
    return interaction.editReply("You cannot add your own server to itself.");
  }

  const savedServer = {
    host_id: interaction.guild.id,
    server_id: invite.guild.id,
    name: invite.guild.name || "Unknown Server",
    description: invite.guild.description || "No server description is set.",
    icon: getGuildIcon(invite.guild),
    invite: `https://discord.gg/${invite.code}`,
    category: interaction.options.getString("category") || "General",
    added_by: interaction.user.id,
    added_at: new Date().toISOString()
  };

  sql.upsertPanelServer.run(savedServer);

  await logAction(
    interaction.guild,
    "Server Added",
    `${interaction.user} added **${savedServer.name}**.`,
    0x57f287
  );

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("Server Added")
        .setDescription(`Added **${savedServer.name}** to /send.`)
        .setThumbnail(savedServer.icon)
    ]
  });
}

async function handleRemoveServer(interaction) {
  const servers = sql
    .listPanelServers.all(interaction.guild.id)
    .filter((server) => server.server_id !== interaction.guild.id);

  if (!servers.length) {
    return interaction.reply({
      content: "No removable servers saved.",
      ephemeral: true
    });
  }

  const rows = chunkArray(servers.slice(0, 125), 25)
    .slice(0, 5)
    .map((part, index) =>
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`removeserver:${interaction.guild.id}:${index}`)
          .setPlaceholder("Choose server to remove")
          .addOptions(
            part.map((server) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(server.name.slice(0, 100))
                .setDescription((server.category || "General").slice(0, 100))
                .setValue(server.server_id)
            )
          )
      )
    );

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("Remove Server")
        .setDescription("Pick a server to remove from /send.")
    ],
    components: rows,
    ephemeral: true
  });
}

async function handleEditServer(interaction) {
  const query = interaction.options.getString("server", true).toLowerCase();

  const server = sql
    .listPanelServers.all(interaction.guild.id)
    .find(
      (item) =>
        item.server_id === query ||
        item.name.toLowerCase().includes(query)
    );

  if (!server) {
    return interaction.reply({
      content: "Saved server not found.",
      ephemeral: true
    });
  }

  sql.editPanelServer.run(
    interaction.options.getString("name"),
    interaction.options.getString("description"),
    interaction.options.getString("category"),
    interaction.guild.id,
    server.server_id
  );

  await logAction(
    interaction.guild,
    "Server Edited",
    `${interaction.user} edited **${server.name}**.`
  );

  return interaction.reply({
    content: "Saved server updated.",
    ephemeral: true
  });
}

async function handleSetTheme(interaction) {
  const color = parseHexColor(interaction.options.getString("color", true));

  if (color === null) {
    return interaction.reply({
      content: "Use a valid hex color like `#5865F2`.",
      ephemeral: true
    });
  }

  sql.setTheme.run(color, interaction.guild.id);

  await logAction(
    interaction.guild,
    "Theme Updated",
    `${interaction.user} set theme to #${color.toString(16).padStart(6, "0")}.`,
    color
  );

  return interaction.reply({
    content: "Theme updated.",
    ephemeral: true
  });
}

async function handleSetChannel(interaction, type) {
  const channel = interaction.options.getChannel("channel", true);

  if (!(await botCanPost(interaction.guild, channel))) {
    return interaction.reply({
      content: `I need View Channel, Send Messages, and Embed Links in ${channel}.`,
      ephemeral: true
    });
  }

  if (type === "panel") {
    sql.setPanelChannel.run(channel.id, interaction.guild.id);
  } else {
    sql.setLogChannel.run(channel.id, interaction.guild.id);
  }

  await logAction(
    interaction.guild,
    type === "panel" ? "Panel Channel Set" : "Log Channel Set",
    `${interaction.user} set ${type} channel to ${channel}.`
  );

  return interaction.reply({
    content: `${type === "panel" ? "Panel" : "Log"} channel set to ${channel}.`,
    ephemeral: true
  });
}

async function handleAutopost(interaction) {
  const enabled = interaction.options.getBoolean("enabled", true);
  const hours = interaction.options.getInteger("every_hours") || 24;
  const channel = interaction.options.getChannel("channel");
  const settings = getSettings(interaction.guild.id);

  if (enabled && !channel && !settings.panel_channel) {
    return interaction.reply({
      content: "Set a channel first with `/setchannel` or provide the `channel` option.",
      ephemeral: true
    });
  }

  if (channel && !(await botCanPost(interaction.guild, channel))) {
    return interaction.reply({
      content: `I need posting permissions in ${channel}.`,
      ephemeral: true
    });
  }

  sql.setAutopost.run(
    enabled ? 1 : 0,
    hours,
    channel?.id || null,
    interaction.guild.id
  );

  await logAction(
    interaction.guild,
    "Autopost Updated",
    `${interaction.user} turned autopost ${enabled ? "on" : "off"}.`
  );

  return interaction.reply({
    content: `Autopost ${enabled ? `enabled every ${hours}h` : "disabled"}.`,
    ephemeral: true
  });
}

async function handleAutosave(interaction) {
  const enabled = interaction.options.getBoolean("enabled", true);
  const hours = interaction.options.getInteger("every_hours") || 24;

  sql.setAutosave.run(
    enabled ? 1 : 0,
    hours,
    interaction.guild.id
  );

  await logAction(
    interaction.guild,
    "Autosave Updated",
    `${interaction.user} turned autosave ${enabled ? "on" : "off"}.`
  );

  return interaction.reply({
    content: `Autosave ${enabled ? `enabled every ${hours}h` : "disabled"}.`,
    ephemeral: true
  });
}

async function handleBackupSettings(interaction) {
  const maxSaves = interaction.options.getInteger("max_saves", true);

  sql.setMaxSaves.run(maxSaves, interaction.guild.id);

  const deleted = enforceBackupLimit(interaction.guild.id);

  return interaction.reply({
    content: `Max saves set to ${maxSaves}.${deleted ? ` Deleted ${deleted} old backup(s).` : ""}`,
    ephemeral: true
  });
}

async function handleSave(interaction) {
  await interaction.deferReply({
    ephemeral: true
  });

  const name = interaction.options.getString("name", true).slice(0, 100);
  const snap = await createSnapshot(interaction.guild, interaction.user.id, name);

  const result = sql.addBackup.run(
    interaction.guild.id,
    name,
    interaction.user.id,
    new Date().toISOString(),
    JSON.stringify(snap)
  );

  const deleted = enforceBackupLimit(interaction.guild.id);
  const counts = backupCounts(snap);

  await logAction(
    interaction.guild,
    "Backup Saved",
    `${interaction.user} saved **${name}** (#${result.lastInsertRowid}).`,
    0x57f287
  );

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("Backup Saved")
        .setDescription(`Saved **${name}** as #${result.lastInsertRowid}.`)
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
          text: deleted
            ? `Deleted ${deleted} old backup(s).`
            : "Does not save messages, members, boosts, ownership, or integrations."
        })
    ]
  });
}

async function handleBackup(interaction) {
  const backups = sql.listBackups.all(interaction.guild.id);

  if (!backups.length) {
    return interaction.reply({
      content: "No backups yet. Use `/save`.",
      ephemeral: true
    });
  }

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(getSettings(interaction.guild.id).theme)
        .setTitle("Backups")
        .setDescription("Pick one to preview/load. Restore needs two confirmations.")
    ],
    components: buildBackupSelectRows(interaction.guild.id, "backup"),
    ephemeral: true
  });
}

async function handleRestorePreview(interaction) {
  await interaction.deferReply({
    ephemeral: true
  });

  const backup = findBackup(
    interaction.guild.id,
    interaction.options.getString("backup", true)
  );

  if (!backup) {
    return interaction.editReply("Backup not found.");
  }

  const snap = JSON.parse(backup.data);

  if (!isValidSnapshot(snap)) {
    return interaction.editReply("Backup is invalid.");
  }

  const preview = await compareSnapshot(interaction.guild, snap);

  return interaction.editReply({
    embeds: [buildRestorePreviewEmbed(backup, snap, preview)]
  });
}

async function handleDeleteBackup(interaction) {
  const backups = sql.listBackups.all(interaction.guild.id);

  if (!backups.length) {
    return interaction.reply({
      content: "No backups to delete.",
      ephemeral: true
    });
  }

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("Delete Backup")
        .setDescription("Pick one backup to delete.")
    ],
    components: buildBackupSelectRows(interaction.guild.id, "deletebackup"),
    ephemeral: true
  });
}

async function handleExportBackup(interaction) {
  await interaction.deferReply({
    ephemeral: true
  });

  const backup = findBackup(
    interaction.guild.id,
    interaction.options.getString("backup") || ""
  );

  if (!backup) {
    return interaction.editReply("No backup found.");
  }

  const payload = {
    exportedByBot: true,
    exportedAt: new Date().toISOString(),
    backupId: backup.id,
    backupName: backup.name,
    sourceGuildId: interaction.guild.id,
    sourceGuildName: interaction.guild.name,
    snapshot: JSON.parse(backup.data)
  };

  const file = new AttachmentBuilder(
    Buffer.from(JSON.stringify(payload, null, 2)),
    {
      name: `${safeFileName(interaction.guild.name)}-${safeFileName(backup.name)}.json`
    }
  );

  await logAction(
    interaction.guild,
    "Backup Exported",
    `${interaction.user} exported **${backup.name}** (#${backup.id}).`
  );

  return interaction.editReply({
    content: `Exported **${backup.name}**.`,
    files: [file]
  });
}

async function handleImportBackup(interaction) {
  await interaction.deferReply({
    ephemeral: true
  });

  const file = interaction.options.getAttachment("file", true);

  if (!file.name.toLowerCase().endsWith(".json")) {
    return interaction.editReply("Upload a `.json` file.");
  }

  if (file.size > 2_000_000) {
    return interaction.editReply("File too large. Keep it under 2 MB.");
  }

  const raw = await fetch(file.url).then((response) => response.text());

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return interaction.editReply("Invalid JSON.");
  }

  const snap = parsed.snapshot || parsed;

  if (!isValidSnapshot(snap)) {
    return interaction.editReply("That JSON does not look like a backup from this bot.");
  }

  const name = (
    interaction.options.getString("name") ||
    parsed.backupName ||
    snap.saveName ||
    "Imported Backup"
  ).slice(0, 100);

  const result = sql.addBackup.run(
    interaction.guild.id,
    name,
    interaction.user.id,
    new Date().toISOString(),
    JSON.stringify(snap)
  );

  const deleted = enforceBackupLimit(interaction.guild.id);
  const counts = backupCounts(snap);

  await logAction(
    interaction.guild,
    "Backup Imported",
    `${interaction.user} imported **${name}** (#${result.lastInsertRowid}).`,
    0x57f287
  );

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("Backup Imported")
        .setDescription(`Imported **${name}** as #${result.lastInsertRowid}. It has not been loaded yet.`)
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
          text: deleted
            ? `Deleted ${deleted} old backup(s).`
            : "Use /restorepreview or /backup to load."
        })
    ]
  });
}

async function handleRemoveServerSelect(interaction) {
  const server = sql.getPanelServer.get(interaction.guild.id, interaction.values[0]);

  if (!server) {
    return interaction.update({
      content: "Already removed.",
      embeds: [],
      components: []
    });
  }

  if (server.server_id === interaction.guild.id) {
    return interaction.reply({
      content: "Cannot remove your own server.",
      ephemeral: true
    });
  }

  sql.deletePanelServer.run(interaction.guild.id, server.server_id);

  await logAction(
    interaction.guild,
    "Server Removed",
    `${interaction.user} removed **${server.name}**.`,
    0xed4245
  );

  return interaction.update({
    content: `Removed **${server.name}**.`,
    embeds: [],
    components: []
  });
}

async function handleBackupSelect(interaction) {
  const backup = sql.getBackup.get(interaction.guild.id, Number(interaction.values[0]));

  if (!backup) {
    return interaction.update({
      content: "Backup not found.",
      embeds: [],
      components: []
    });
  }

  const snap = JSON.parse(backup.data);

  if (!isValidSnapshot(snap)) {
    return interaction.update({
      content: "Backup is invalid.",
      embeds: [],
      components: []
    });
  }

  const preview = await compareSnapshot(interaction.guild, snap);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`restore1:${backup.id}:${interaction.user.id}`)
      .setLabel("Continue")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`cancel:${interaction.user.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.update({
    embeds: [
      buildRestorePreviewEmbed(backup, snap, preview)
        .setDescription("This is additive. It will not delete existing roles, channels, or messages.")
    ],
    components: [row]
  });
}

async function handleDeleteBackupSelect(interaction) {
  const backup = sql.getBackup.get(interaction.guild.id, Number(interaction.values[0]));

  if (!backup) {
    return interaction.update({
      content: "Already deleted.",
      embeds: [],
      components: []
    });
  }

  sql.deleteBackup.run(interaction.guild.id, backup.id);

  await logAction(
    interaction.guild,
    "Backup Deleted",
    `${interaction.user} deleted **${backup.name}** (#${backup.id}).`,
    0xed4245
  );

  return interaction.update({
    content: `Deleted **${backup.name}** (#${backup.id}).`,
    embeds: [],
    components: []
  });
}

async function handleRestoreFirstConfirm(interaction) {
  const [, backupId, userId] = interaction.customId.split(":");

  if (interaction.user.id !== userId) {
    return interaction.reply({
      content: "Not your restore panel.",
      ephemeral: true
    });
  }

  const backup = sql.getBackup.get(interaction.guild.id, Number(backupId));

  if (!backup) {
    return interaction.update({
      content: "Backup not found.",
      embeds: [],
      components: []
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`restore2:${backup.id}:${interaction.user.id}`)
      .setLabel("Load Backup Now")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`cancel:${interaction.user.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("Final Confirmation")
        .setDescription(`Load **${backup.name}** now? This modifies roles/channels but does not delete existing ones.`)
    ],
    components: [row]
  });
}

async function handleRestoreSecondConfirm(interaction) {
  const [, backupId, userId] = interaction.customId.split(":");

  if (interaction.user.id !== userId) {
    return interaction.reply({
      content: "Not your restore panel.",
      ephemeral: true
    });
  }

  await interaction.deferReply({
    ephemeral: true
  });

  const backup = sql.getBackup.get(interaction.guild.id, Number(backupId));

  if (!backup) {
    return interaction.editReply("Backup not found.");
  }

  const snap = JSON.parse(backup.data);

  if (!isValidSnapshot(snap)) {
    return interaction.editReply("Backup is invalid.");
  }

  const result = await restoreSnapshot(interaction.guild, snap);

  await logAction(
    interaction.guild,
    "Backup Loaded",
    `${interaction.user} loaded **${backup.name}** (#${backup.id}).`,
    0xed4245
  );

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("Backup Loaded")
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
            value: `${result.skipped}/${result.failed}`,
            inline: true
          }
        )
    ]
  });
}

async function handleSetupChannelSelect(interaction) {
  if (!hasManageServer(interaction)) {
    return interaction.reply({
      content: "You need **Manage Server**.",
      ephemeral: true
    });
  }

  const parts = interaction.customId.split(":");

  if (parts[1] !== interaction.guild.id) {
    return interaction.reply({
      content: "Wrong server setup panel.",
      ephemeral: true
    });
  }

  const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);

  if (!channel?.isTextBased()) {
    return interaction.reply({
      content: "Invalid channel.",
      ephemeral: true
    });
  }

  if (!(await botCanPost(interaction.guild, channel))) {
    return interaction.reply({
      content: `I need posting permissions in ${channel}.`,
      ephemeral: true
    });
  }

  if (parts[0] === "setup-panel") {
    sql.setPanelChannel.run(channel.id, interaction.guild.id);
  } else {
    sql.setLogChannel.run(channel.id, interaction.guild.id);
  }

  await logAction(
    interaction.guild,
    "Setup Updated",
    `${interaction.user} set ${parts[0] === "setup-panel" ? "panel" : "log"} channel to ${channel}.`
  );

  return interaction.reply({
    content: `Set ${parts[0] === "setup-panel" ? "panel" : "log"} channel to ${channel}.`,
    ephemeral: true
  });
}

async function handleSetupAutopostButton(interaction) {
  if (!hasManageServer(interaction)) {
    return interaction.reply({
      content: "You need **Manage Server**.",
      ephemeral: true
    });
  }

  const settings = getSettings(interaction.guild.id);

  if (!settings.panel_channel) {
    return interaction.reply({
      content: "Set a panel channel first.",
      ephemeral: true
    });
  }

  sql.setAutopost.run(
    settings.autopost ? 0 : 1,
    settings.autopost_hours || 24,
    null,
    interaction.guild.id
  );

  return interaction.reply({
    content: `Autopost is now ${settings.autopost ? "off" : "on"}.`,
    ephemeral: true
  });
}

async function runAutoposts() {
  const now = Date.now();

  for (const settings of sql.listAutoposts.all()) {
    const everyMs = (settings.autopost_hours || 24) * 60 * 60 * 1000;

    if (settings.last_autopost && now - settings.last_autopost < everyMs) {
      continue;
    }

    const guild = await client.guilds.fetch(settings.guild_id).catch(() => null);
    if (!guild) continue;

    const channel = await guild.channels.fetch(settings.panel_channel).catch(() => null);
    if (!channel?.isTextBased()) continue;

    await channel.send(await buildPanelPayload(guild));
    sql.setLastAutopost.run(now, settings.guild_id);
  }
}

async function runAutosaves() {
  const now = Date.now();

  for (const settings of sql.listAutosaves.all()) {
    const everyMs = (settings.autosave_hours || 24) * 60 * 60 * 1000;

    if (settings.last_autosave && now - settings.last_autosave < everyMs) {
      continue;
    }

    const guild = await client.guilds.fetch(settings.guild_id).catch(() => null);
    if (!guild) continue;

    const name = `Autosave ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
    const snap = await createSnapshot(guild, client.user.id, name);

    const result = sql.addBackup.run(
      guild.id,
      name,
      client.user.id,
      new Date().toISOString(),
      JSON.stringify(snap)
    );

    const deleted = enforceBackupLimit(guild.id);

    sql.setLastAutosave.run(now, guild.id);

    await logAction(
      guild,
      "Autosave Created",
      `Created **${name}** (#${result.lastInsertRowid}).${deleted ? ` Deleted ${deleted} old backup(s).` : ""}`,
      0x57f287
    );
  }
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);

  setInterval(() => runAutoposts().catch(console.error), 60_000);
  setInterval(() => runAutosaves().catch(console.error), 60_000);

  runAutoposts().catch(console.error);
  runAutosaves().catch(console.error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) {
        return interaction.reply({
          content: "Use this inside a server.",
          ephemeral: true
        });
      }

      const publicCommands = ["send", "preview", "serverlist", "config"];

      if (!hasManageServer(interaction) && !publicCommands.includes(interaction.commandName)) {
        return interaction.reply({
          content: "You need **Manage Server**.",
          ephemeral: true
        });
      }

      switch (interaction.commandName) {
        case "send":
          return handleSend(interaction);

        case "preview":
          return interaction.reply({
            ...(await buildPanelPayload(interaction.guild, true)),
            ephemeral: true
          });

        case "serverlist":
          return handleServerList(interaction);

        case "config":
          return interaction.reply({
            embeds: [buildConfigEmbed(interaction.guild)],
            ephemeral: true
          });

        case "setup":
          return handleSetup(interaction);

        case "addserver":
          return handleAddServer(interaction);

        case "removeserver":
          return handleRemoveServer(interaction);

        case "editserver":
          return handleEditServer(interaction);

        case "settheme":
          return handleSetTheme(interaction);

        case "setchannel":
          return handleSetChannel(interaction, "panel");

        case "setlogchannel":
          return handleSetChannel(interaction, "log");

        case "autopost":
          return handleAutopost(interaction);

        case "autosave":
          return handleAutosave(interaction);

        case "backupsettings":
          return handleBackupSettings(interaction);

        case "save":
          return handleSave(interaction);

        case "backup":
          return handleBackup(interaction);

        case "restorepreview":
          return handleRestorePreview(interaction);

        case "deletebackup":
          return handleDeleteBackup(interaction);

        case "exportbackup":
          return handleExportBackup(interaction);

        case "importbackup":
          return handleImportBackup(interaction);

        default:
          return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (!hasManageServer(interaction)) {
        return interaction.reply({
          content: "You need **Manage Server**.",
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("removeserver:")) {
        return handleRemoveServerSelect(interaction);
      }

      if (interaction.customId.startsWith("backup:")) {
        return handleBackupSelect(interaction);
      }

      if (interaction.customId.startsWith("deletebackup:")) {
        return handleDeleteBackupSelect(interaction);
      }
    }

    if (interaction.isChannelSelectMenu()) {
      return handleSetupChannelSelect(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("restore1:")) {
        return handleRestoreFirstConfirm(interaction);
      }

      if (interaction.customId.startsWith("restore2:")) {
        return handleRestoreSecondConfirm(interaction);
      }

      if (interaction.customId.startsWith("cancel:")) {
        return interaction.update({
          content: "Cancelled.",
          embeds: [],
          components: []
        });
      }

      if (interaction.customId.startsWith("setup-preview:")) {
        return interaction.reply({
          ...(await buildPanelPayload(interaction.guild, true)),
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("setup-config:")) {
        return interaction.reply({
          embeds: [buildConfigEmbed(interaction.guild)],
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("setup-autopost:")) {
        return handleSetupAutopostButton(interaction);
      }
    }
  } catch (error) {
    console.error(error);

    const payload = {
      content: `Something went wrong: ${error.message}`,
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

(async () => {
  const rest = new REST({
    version: "10"
  }).setToken(DISCORD_TOKEN);

  console.log("Registering global slash commands...");

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    {
      body: commands
    }
  );

  console.log("Commands registered.");

  await client.login(DISCORD_TOKEN);
})();
