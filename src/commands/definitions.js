const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = [
  // ── /cng ───────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('cng')
    .setDescription('Rename your clan channel (supports emojis)')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('New clan name')
        .setRequired(true)
        .setMaxLength(50)
    ),

  // ── /addrole ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('addrole')
    .setDescription('Create a custom role for your clan')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Role name (supports emojis)')
        .setRequired(true)
        .setMaxLength(50)
    )
    .addStringOption(opt =>
      opt.setName('color')
        .setDescription('Role color as hex (e.g. #FF5733) or leave blank')
        .setRequired(false)
    ),

  // ── /role ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Apply one of your clan roles to a specific member')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Member to apply role to')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('role_id')
        .setDescription('Role ID to apply (use /listroles to see your roles)')
        .setRequired(true)
    ),

  // ── /roleall ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('roleall')
    .setDescription('Apply one of your clan roles to all members')
    .addStringOption(opt =>
      opt.setName('role_id')
        .setDescription('Role ID to apply (use /listroles to see your roles)')
        .setRequired(true)
    ),

  // ── /clanswap ──────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('clanswap')
    .setDescription('Transfer your clan ownership to another member')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Member to transfer ownership to')
        .setRequired(true)
    ),

  // ── /listroles ────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('listroles')
    .setDescription('List all custom roles you have created for this clan'),

  // ── /panel ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('(Admin) Send or refresh the clan creation panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];
