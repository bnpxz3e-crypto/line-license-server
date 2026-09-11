// LINE OA Auto Calculator V8
// License Server - PostgreSQL version

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not configured.');
  process.exit(1);
}

if (!ADMIN_TOKEN) {
  console.error('ERROR: ADMIN_TOKEN is not configured.');
  process.exit(1);
}

/*
 * PostgreSQL connection
 */
const pool = new Pool({
  connectionString: DATABASE_URL,

  // Render PostgreSQL supports SSL.
  ssl: {
    rejectUnauthorized: false
  },

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});


/*
 * Initialize database
 */
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      key TEXT PRIMARY KEY,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      note TEXT NOT NULL DEFAULT '',
      revoked_at TIMESTAMPTZ
    )
  `);

  console.log('Database initialized successfully.');
}


/*
 * Admin authentication
 */
function auth(req, res, next) {
  const header = req.headers.authorization || '';

  if (header !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({
      ok: false,
      error: 'unauthorized'
    });
  }

  next();
}


/*
 * Convert database row
 * to the same format used by admin.html
 */
function formatLicense(row) {
  return {
    revoked: row.revoked,
    createdAt: row.created_at,
    note: row.note || '',
    ...(row.revoked_at
      ? { revokedAt: row.revoked_at }
      : {})
  };
}


/*
 * Health check
 */
app.get('/', (req, res) => {
  res.json({
    ok: true,
    name: 'LINE OA Auto Calculator License Server',
    version: 'V8',
    storage: 'postgresql'
  });
});


/*
 * Admin page
 */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});


/*
 * Check License
 *
 * Used by the Chrome Extension
 *
 * POST /api/check
 *
 * Body:
 * {
 *   "key": "E-001"
 * }
 */
app.post('/api/check', async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim();

    if (!key) {
      return res.json({
        ok: true,
        active: false,
        reason: 'not_found',
        expiresAt: null
      });
    }

    const result = await pool.query(
      `
      SELECT
        key,
        revoked
      FROM licenses
      WHERE key = $1
      LIMIT 1
      `,
      [key]
    );

    if (result.rows.length === 0) {
      return res.json({
        ok: true,
        active: false,
        reason: 'not_found',
        expiresAt: null
      });
    }

    const license = result.rows[0];

    if (license.revoked) {
      return res.json({
        ok: true,
        active: false,
        reason: 'revoked',
        expiresAt: null
      });
    }

    return res.json({
      ok: true,
      active: true,
      key: license.key,
      expiresAt: null
    });

  } catch (error) {
    console.error('License check error:', error);

    return res.status(500).json({
      ok: false,
      active: false,
      error: 'server_error'
    });
  }
});


/*
 * Get all licenses
 *
 * GET /api/admin/licenses
 */
app.get('/api/admin/licenses', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        key,
        revoked,
        created_at,
        note,
        revoked_at
      FROM licenses
      ORDER BY created_at DESC
    `);

    const licenses = {};

    for (const row of result.rows) {
      licenses[row.key] = formatLicense(row);
    }

    return res.json({
      ok: true,
      licenses
    });

  } catch (error) {
    console.error('Get licenses error:', error);

    return res.status(500).json({
      ok: false,
      error: 'server_error'
    });
  }
});


/*
 * Create License
 *
 * POST /api/admin/licenses
 *
 * Body:
 * {
 *   "key": "E-001",
 *   "note": "ลูกค้า A"
 * }
 */
app.post('/api/admin/licenses', auth, async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim();
    const note = String(req.body?.note || '');

    if (!key) {
      return res.status(400).json({
        ok: false,
        error: 'key required'
      });
    }

    const result = await pool.query(
      `
      INSERT INTO licenses
        (key, revoked, created_at, note)
      VALUES
        ($1, FALSE, NOW(), $2)
      RETURNING
        key,
        revoked,
        created_at,
        note,
        revoked_at
      `,
      [key, note]
    );

    const row = result.rows[0];

    return res.json({
      ok: true,
      key: row.key,
      license: formatLicense(row)
    });

  } catch (error) {

    // PostgreSQL unique violation
    if (error.code === '23505') {
      return res.status(409).json({
        ok: false,
        error: 'key already exists'
      });
    }

    console.error('Create license error:', error);

    return res.status(500).json({
      ok: false,
      error: 'server_error'
    });
  }
});


/*
 * Revoke License
 *
 * POST /api/admin/licenses/:key/revoke
 */
app.post('/api/admin/licenses/:key/revoke', auth, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();

    const result = await pool.query(
      `
      UPDATE licenses
      SET
        revoked = TRUE,
        revoked_at = NOW()
      WHERE key = $1
      RETURNING key
      `,
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'not found'
      });
    }

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error('Revoke license error:', error);

    return res.status(500).json({
      ok: false,
      error: 'server_error'
    });
  }
});


/*
 * Unrevoke License
 *
 * POST /api/admin/licenses/:key/unrevoke
 */
app.post('/api/admin/licenses/:key/unrevoke', auth, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();

    const result = await pool.query(
      `
      UPDATE licenses
      SET
        revoked = FALSE,
        revoked_at = NULL
      WHERE key = $1
      RETURNING key
      `,
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'not found'
      });
    }

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error('Unrevoke license error:', error);

    return res.status(500).json({
      ok: false,
      error: 'server_error'
    });
  }
});


/*
 * Delete License
 *
 * DELETE /api/admin/licenses/:key
 */
app.delete('/api/admin/licenses/:key', auth, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();

    const result = await pool.query(
      `
      DELETE FROM licenses
      WHERE key = $1
      RETURNING key
      `,
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'not found'
      });
    }

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error('Delete license error:', error);

    return res.status(500).json({
      ok: false,
      error: 'server_error'
    });
  }
});


/*
 * Start server only after database is ready
 */
async function startServer() {
  try {
    await initDatabase();

    // Test connection
    await pool.query('SELECT 1');

    console.log('PostgreSQL connection OK.');

    app.listen(PORT, () => {
      console.log(`License server listening on port ${PORT}`);
    });

  } catch (error) {
    console.error('Failed to start server.');
    console.error(error);

    process.exit(1);
  }
}

startServer();
