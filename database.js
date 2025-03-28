import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class DatabaseManager {
  constructor() {
    this.dbPath = path.join(__dirname, 'chat_database.sqlite');
    this.db = null;
  }

  async init() {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });

    // Create tables if they don't exist
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT,
        recipient_type TEXT, 
        recipient_id TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_read INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS group_chats (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT,
        user_id TEXT,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id)
      );
    `);
  }

  async saveMessage(senderId, recipientType, recipientId, message) {
    await this.db.run(
      'INSERT INTO messages (sender_id, recipient_type, recipient_id, message) VALUES (?, ?, ?, ?)', 
      [senderId, recipientType, recipientId, message]
    );
  }

  async getUnreadMessages(userId) {
    // Fetch unread messages for both private and group chats
    const privateMessages = await this.db.all(`
      SELECT * FROM messages 
      WHERE (recipient_type = 'private' AND recipient_id = ?) OR 
            (recipient_type = 'group' AND is_read = 0)
      ORDER BY timestamp
    `, [userId]);

    return privateMessages;
  }

  async markMessagesAsRead(userId) {
    await this.db.run(`
      UPDATE messages 
      SET is_read = 1 
      WHERE (recipient_type = 'private' AND recipient_id = ?) OR 
            (recipient_type = 'group')
    `, [userId]);
  }

  async createGroup(groupId, groupName) {
    await this.db.run(
      'INSERT OR REPLACE INTO group_chats (id, name) VALUES (?, ?)', 
      [groupId, groupName]
    );
  }

  async addGroupMember(groupId, userId) {
    await this.db.run(
      'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)', 
      [groupId, userId]
    );
  }

  async getGroupMembers(groupId) {
    return await this.db.all(
      'SELECT user_id FROM group_members WHERE group_id = ?', 
      [groupId]
    );
  }
}

export default new DatabaseManager();
