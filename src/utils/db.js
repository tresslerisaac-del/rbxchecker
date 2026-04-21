const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/clans.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_open INTEGER NOT NULL DEFAULT 1,
      is_18plus INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS clan_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(clan_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS clan_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      role_name TEXT NOT NULL,
      UNIQUE(clan_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS cooldowns (
      user_id TEXT PRIMARY KEY,
      available_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
      requester_id TEXT NOT NULL,
      message_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(clan_id, requester_id)
    );
  `);
}

// ─── Clan queries ─────────────────────────────────────────────────────────────

function createClan(ownerId, channelId, guildId, name, is18plus) {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO clans (owner_id, channel_id, guild_id, name, is_18plus)
    VALUES (?, ?, ?, ?, ?)
  `).run(ownerId, channelId, guildId, name, is18plus ? 1 : 0);
  addMember(info.lastInsertRowid, ownerId);
  return info.lastInsertRowid;
}

function getClanByOwner(ownerId, guildId) {
  return getDb().prepare(`
    SELECT * FROM clans WHERE owner_id = ? AND guild_id = ? AND deleted_at IS NULL
  `).all(ownerId, guildId);
}

function getClanByChannel(channelId) {
  return getDb().prepare(`
    SELECT * FROM clans WHERE channel_id = ? AND deleted_at IS NULL
  `).get(channelId);
}

function getClanById(clanId) {
  return getDb().prepare(`SELECT * FROM clans WHERE id = ?`).get(clanId);
}

function updateClanName(clanId, name) {
  return getDb().prepare(`UPDATE clans SET name = ? WHERE id = ?`).run(name, clanId);
}

function updateClanOpen(clanId, isOpen) {
  return getDb().prepare(`UPDATE clans SET is_open = ? WHERE id = ?`).run(isOpen ? 1 : 0, clanId);
}

function transferOwner(clanId, newOwnerId) {
  return getDb().prepare(`UPDATE clans SET owner_id = ? WHERE id = ?`).run(newOwnerId, clanId);
}

function deleteClan(clanId) {
  return getDb().prepare(`UPDATE clans SET deleted_at = strftime('%s','now') WHERE id = ?`).run(clanId);
}

// ─── Members ──────────────────────────────────────────────────────────────────

function addMember(clanId, userId) {
  return getDb().prepare(`
    INSERT OR IGNORE INTO clan_members (clan_id, user_id) VALUES (?, ?)
  `).run(clanId, userId);
}

function removeMember(clanId, userId) {
  return getDb().prepare(`DELETE FROM clan_members WHERE clan_id = ? AND user_id = ?`).run(clanId, userId);
}

function getMembers(clanId) {
  return getDb().prepare(`SELECT user_id FROM clan_members WHERE clan_id = ?`).all(clanId);
}

function isMember(clanId, userId) {
  return !!getDb().prepare(`SELECT 1 FROM clan_members WHERE clan_id = ? AND user_id = ?`).get(clanId, userId);
}

// ─── Clan roles ───────────────────────────────────────────────────────────────

function addClanRole(clanId, roleId, roleName) {
  return getDb().prepare(`
    INSERT OR IGNORE INTO clan_roles (clan_id, role_id, role_name) VALUES (?, ?, ?)
  `).run(clanId, roleId, roleName);
}

function getClanRoles(clanId) {
  return getDb().prepare(`SELECT * FROM clan_roles WHERE clan_id = ?`).all(clanId);
}

function removeClanRoles(clanId) {
  return getDb().prepare(`DELETE FROM clan_roles WHERE clan_id = ?`).run(clanId);
}

// ─── Cooldowns ────────────────────────────────────────────────────────────────

const SIX_HOURS = 6 * 60 * 60;

function setCooldown(userId) {
  const available = Math.floor(Date.now() / 1000) + SIX_HOURS;
  return getDb().prepare(`
    INSERT OR REPLACE INTO cooldowns (user_id, available_at) VALUES (?, ?)
  `).run(userId, available);
}

function getCooldown(userId) {
  const row = getDb().prepare(`SELECT available_at FROM cooldowns WHERE user_id = ?`).get(userId);
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.available_at <= now) {
    getDb().prepare(`DELETE FROM cooldowns WHERE user_id = ?`).run(userId);
    return null;
  }
  return row.available_at;
}

// ─── Join requests ────────────────────────────────────────────────────────────

function createJoinRequest(clanId, requesterId, messageId) {
  return getDb().prepare(`
    INSERT OR REPLACE INTO join_requests (clan_id, requester_id, message_id, status)
    VALUES (?, ?, ?, 'pending')
  `).run(clanId, requesterId, messageId);
}

function getJoinRequest(clanId, requesterId) {
  return getDb().prepare(`
    SELECT * FROM join_requests WHERE clan_id = ? AND requester_id = ? AND status = 'pending'
  `).get(clanId, requesterId);
}

function updateJoinRequest(id, status) {
  return getDb().prepare(`UPDATE join_requests SET status = ? WHERE id = ?`).run(status, id);
}

module.exports = {
  getDb,
  createClan, getClanByOwner, getClanByChannel, getClanById,
  updateClanName, updateClanOpen, transferOwner, deleteClan,
  addMember, removeMember, getMembers, isMember,
  addClanRole, getClanRoles, removeClanRoles,
  setCooldown, getCooldown,
  createJoinRequest, getJoinRequest, updateJoinRequest,
};
