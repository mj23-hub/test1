const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'attendance.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS committees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    committee_id INTEGER NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    committee_id INTEGER NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
    meeting_date TEXT NOT NULL,
    title TEXT
  );

  CREATE TABLE IF NOT EXISTS attendance (
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    present INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (meeting_id, member_id)
  );

  CREATE INDEX IF NOT EXISTS idx_members_committee ON members(committee_id);
  CREATE INDEX IF NOT EXISTS idx_meetings_committee ON meetings(committee_id);
  CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date);
`);

module.exports = db;
