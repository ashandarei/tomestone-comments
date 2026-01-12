require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
db.initializeDatabase();

// Parse allowed origins from environment
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://tomestone.gg')
  .split(',')
  .map(origin => origin.trim());

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Allow any moz-extension:// or chrome-extension:// origin (browser extensions)
    if (origin.startsWith('moz-extension://') || origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Nickname']
}));

// Parse JSON bodies
app.use(express.json());

// Rate limiting - 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// Stricter rate limit for creating comments
const createLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 comments per minute
  message: { error: 'Too many comments, please slow down.' }
});

// Root endpoint - API info
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Tomestone Comments API</title>
      <style>
        body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #fff; padding: 40px; max-width: 600px; margin: 0 auto; }
        h1 { color: #3b82f6; }
        code { background: #1a1a1a; padding: 2px 6px; border-radius: 4px; }
        .endpoint { background: #111; padding: 12px; border-radius: 8px; margin: 10px 0; border-left: 3px solid #3b82f6; }
        .method { color: #22c55e; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>💬 Tomestone Comments API</h1>
      <p>Backend API for the Tomestone.gg Comments Firefox Extension</p>
      <h2>Endpoints</h2>
      <div class="endpoint"><span class="method">GET</span> <code>/api/health</code> - Health check</div>
      <div class="endpoint"><span class="method">GET</span> <code>/api/comments/:characterId</code> - Get comments</div>
      <div class="endpoint"><span class="method">POST</span> <code>/api/comments</code> - Create comment</div>
      <div class="endpoint"><span class="method">DELETE</span> <code>/api/comments/:id</code> - Delete comment</div>
      <p style="margin-top: 30px; color: #666;">Server is running ✓</p>
    </body>
    </html>
  `);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /api/comments/:characterId - Fetch all comments for a character
app.get('/api/comments/:characterId', (req, res) => {
  try {
    const { characterId } = req.params;
    
    if (!characterId || !/^\d+$/.test(characterId)) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    const comments = db.getCommentsByCharacterId(characterId);
    const count = db.getCommentCount(characterId);

    res.json({ 
      characterId,
      count,
      comments 
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST /api/comments - Create a new comment or reply
app.post('/api/comments', createLimiter, (req, res) => {
  try {
    const { characterId, parentId, content } = req.body;
    const nickname = req.headers['x-nickname'] || req.body.nickname;

    // Validation
    if (!characterId || !/^\d+$/.test(characterId)) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    if (!nickname || nickname.trim().length === 0) {
      return res.status(400).json({ error: 'Nickname is required' });
    }

    if (nickname.length > 50) {
      return res.status(400).json({ error: 'Nickname must be 50 characters or less' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Comment must be 2000 characters or less' });
    }

    // If parentId is provided, verify it exists
    if (parentId) {
      const parentComment = db.getCommentsByCharacterId(characterId)
        .flat()
        .find(c => c.id === parseInt(parentId));
      
      // We'll just proceed even if parent doesn't exist - it will be treated as orphan
    }

    const comment = db.createComment({
      characterId,
      parentId: parentId ? parseInt(parentId) : null,
      nickname: nickname.trim(),
      content: content.trim()
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// DELETE /api/comments/:id - Delete a comment
app.delete('/api/comments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const nickname = req.headers['x-nickname'];

    if (!id || !/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid comment ID' });
    }

    if (!nickname) {
      return res.status(401).json({ error: 'Nickname required for deletion' });
    }

    const result = db.deleteComment(parseInt(id), nickname);

    if (!result.success) {
      return res.status(result.error === 'Comment not found' ? 404 : 403)
        .json({ error: result.error });
    }

    res.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server - bind to 0.0.0.0 so Windows can access WSL2
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Tomestone Comments API running on http://${HOST}:${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`Browser extensions (moz-extension://, chrome-extension://) are always allowed`);
});
