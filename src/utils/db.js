const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/clans.db');

let db;

async function initDb() {
  if (db) return db;

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  initTables();
  setInterval(saveDb, 5000);
  return db;
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('[DB] Save error:', err.message);
  }
}

function initTables() {
  db.run(`
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
      clan_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(clan_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS clan_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clan_id INTEGER NOT NULL,
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
      clan_id INTEGER NOT NULL,
      requester_id TEXT NOT NULL,
      message_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(clan_id, requester_id)
    );
  `);
  saveDb();
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  const row = get('SELECT last_insert_rowid() as id');
  return { lastInsertRowid: row?.id };
}

function createClan(ownerId, channelId, guildId, name, is18plus) {
  const result = run(
    `INSERT INTO clans (owner_id, channel_id, guild_id, name, is_18plus) VALUES (?, ?, ?, ?, ?)`,
    [ownerId, channelId, guildId, name, is18plus ? 1 : 0]
  );
  addMember(result.lastInsertRowid, ownerId);
  saveDb();
  return result.lastInsertRowid;
}

function getClanByOwner(ownerId, guildId) {
  return all(`SELECT * FROM clans WHERE owner_id = ? AND guild_id = ? AND deleted_at IS NULL`, [ownerId, guildId]);
}

function getClanByChannel(channelId) {
  return get(`SELECT * FROM clans WHERE channel_id = ? AND deleted_at IS NULL`, [channelId]);
}

function getClanById(clanId) {
  return get(`SELECT * FROM clans WHERE id = ?`, [clanId]);
}

function updateClanName(clanId, name) { run(`UPDATE clans SET name = ? WHERE id = ?`, [name, clanId]); saveDb(); }
function updateClanOpen(clanId, isOpen) { run(`UPDATE clans SET is_open = ? WHERE id = ?`, [isOpen ? 1 : 0, clanId]); saveDb(); }
function transferOwner(clanId, newOwnerId) { run(`UPDATE clans SET owner_id = ? WHERE id = ?`, [newOwnerId, clanId]); saveDb(); }
function deleteClan(clanId) { run(`UPDATE clans SET deleted_at = strftime('%s','now') WHERE id = ?`, [clanId]); saveDb(); }

function addMember(clanId, userId) { run(`INSERT OR IGNORE INTO clan_members (clan_id, user_id) VALUES (?, ?)`, [clanId, userId]); saveDb(); }
function removeMember(clanId, userId) { run(`DELETE FROM clan_members WHERE clan_id = ? AND user_id = ?`, [clanId, userId]); saveDb(); }
function getMembers(clanId) { return all(`SELECT user_id FROM clan_members WHERE clan_id = ?`, [clanId]); }
function isMember(clanId, userId) { return !!get(`SELECT 1 as x FROM clan_members WHERE clan_id = ? AND user_id = ?`, [clanId, userId]); }

function addClanRole(clanId, roleId, roleName) { run(`INSERT OR IGNORE INTO clan_roles (clan_id, role_id, role_name) VALUES (?, ?, ?)`, [clanId, roleId, roleName]); saveDb(); }
function getClanRoles(clanId) { return all(`SELECT * FROM clan_roles WHERE clan_id = ?`, [clanId]); }
function removeClanRoles(clanId) { run(`DELETE FROM clan_roles WHERE clan_id = ?`, [clanId]); saveDb(); }

const SIX_HOURS = 6 * 60 * 60;

function setCooldown(userId) {
  const available = Math.floor(Date.now() / 1000) + SIX_HOURS;
  run(`INSERT OR REPLACE INTO cooldowns (user_id, available_at) VALUES (?, ?)`, [userId, available]);
  saveDb();
}

function getCooldown(userId) {
  const row = get(`SELECT available_at FROM cooldowns WHERE user_id = ?`, [userId]);
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.available_at <= now) { run(`DELETE FROM cooldowns WHERE user_id = ?`, [userId]); saveDb(); return null; }
  return row.available_at;
}

function createJoinRequest(clanId, requesterId, messageId) {
  run(`INSERT OR REPLACE INTO join_requests (clan_id, requester_id, message_id, status) VALUES (?, ?, ?, 'pending')`, [clanId, requesterId, messageId]);
  saveDb();
}

function getJoinRequest(clanId, requesterId) {
  return get(`SELECT * FROM join_requests WHERE clan_id = ? AND requester_id = ? AND status = 'pending'`, [clanId, requesterId]);
}

function getJoinRequestById(id) { return get(`SELECT * FROM join_requests WHERE id = ?`, [id]); }

function updateJoinRequest(id, status) { run(`UPDATE join_requests SET status = ? WHERE id = ?`, [status, id]); saveDb(); }

module.exports = {
  initDb, saveDb,
  createClan, getClanByOwner, getClanByChannel, getClanById,
  updateClanName, updateClanOpen, transferOwner, deleteClan,
  addMember, removeMember, getMembers, isMember,
  addClanRole, getClanRoles, removeClanRoles,
  setCooldown, getCooldown,
  createJoinRequest, getJoinRequest, getJoinRequestById, updateJoinRequest,
};
