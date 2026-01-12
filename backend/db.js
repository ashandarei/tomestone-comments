const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || './comments.db';
const db = new Database(path.resolve(__dirname, dbPath));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Initialize the database schema
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      parent_id INTEGER,
      nickname TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_comments_character_id ON comments(character_id);
    CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
  `);
}

// Get all comments for a character, returned as a nested tree structure
function getCommentsByCharacterId(characterId) {
  const rows = db.prepare(`
    SELECT id, character_id, parent_id, nickname, content, created_at
    FROM comments
    WHERE character_id = ?
    ORDER BY created_at ASC
  `).all(characterId);

  return buildCommentTree(rows);
}

// Build a nested tree structure from flat comment rows
function buildCommentTree(rows) {
  const commentMap = new Map();
  const rootComments = [];

  // First pass: create a map of all comments
  for (const row of rows) {
    commentMap.set(row.id, {
      ...row,
      replies: []
    });
  }

  // Second pass: build the tree structure
  for (const row of rows) {
    const comment = commentMap.get(row.id);
    if (row.parent_id === null) {
      rootComments.push(comment);
    } else {
      const parent = commentMap.get(row.parent_id);
      if (parent) {
        parent.replies.push(comment);
      } else {
        // Orphan comment (parent was deleted), treat as root
        rootComments.push(comment);
      }
    }
  }

  return rootComments;
}

// Create a new comment
function createComment({ characterId, parentId, nickname, content }) {
  const stmt = db.prepare(`
    INSERT INTO comments (character_id, parent_id, nickname, content)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(characterId, parentId || null, nickname, content);
  
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid);
}

// Delete a comment (only if nickname matches)
function deleteComment(id, nickname) {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  
  if (!comment) {
    return { success: false, error: 'Comment not found' };
  }
  
  if (comment.nickname !== nickname) {
    return { success: false, error: 'Not authorized to delete this comment' };
  }

  // Delete the comment and all its replies (cascade)
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  
  return { success: true };
}

// Get comment count for a character
function getCommentCount(characterId) {
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM comments WHERE character_id = ?
  `).get(characterId);
  
  return result.count;
}

module.exports = {
  initializeDatabase,
  getCommentsByCharacterId,
  createComment,
  deleteComment,
  getCommentCount
};
