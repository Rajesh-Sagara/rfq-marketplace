const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { randomUUID } = require('crypto');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL || process.env.DB_URL;

if (!JWT_SECRET) {
  logger.error('Missing JWT_SECRET — set it in environment');
  process.exit(1);
}
if (!DATABASE_URL) {
  logger.error('Missing DATABASE_URL — set Postgres connection string in environment');
  process.exit(1);
}

// Configured Pool with SSL support for Render PostgreSQL
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

// Automatic schema verification & creation on startup
async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('buyer', 'supplier')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS rfqs (
        id SERIAL PRIMARY KEY,
        buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_name TEXT NOT NULL,
        description TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        delivery_location TEXT NOT NULL,
        deadline TIMESTAMP WITH TIME ZONE NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS quotations (
        id SERIAL PRIMARY KEY,
        rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
        supplier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        price NUMERIC NOT NULL,
        delivery_time TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        UNIQUE(rfq_id, supplier_id)
      );
    `);
    logger.info("Database schema verified and successfully initialized.");
  } catch (err) {
    logger.error({ err }, "Database schema initialization failed.");
  } finally {
    client.release();
  }
}

// App configuration & middleware
const app = express();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

app.use((req, res, next) => {
  try { req.id = randomUUID(); } catch (e) { req.id = Math.random().toString(36).slice(2); }
  res.setHeader('X-Request-Id', req.id);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

// Helpers
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

async function getAuthUser(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const payload = verifyToken(auth.slice(7));
  if (!payload || !payload.id) return null;
  const row = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [payload.id]);
  return row.rows[0] || null;
}

// Validation schemas (Zod)
const signupSchema = z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(6), role: z.enum(['buyer', 'supplier']) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const rfqCreateSchema = z.object({
  product_name: z.string().min(1),
  description: z.string().min(1),
  quantity: z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int().positive()),
  delivery_location: z.string().min(1),
  deadline: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid deadline' })
});
const rfqUpdateSchema = rfqCreateSchema.partial().extend({ status: z.enum(['open', 'closed']).optional() });
const quotationSchema = z.object({
  price: z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().positive()),
  delivery_time: z.string().min(1),
  notes: z.string().optional()
});

// Routes
app.post('/api/auth/signup', async (req, res) => {
  try {
    const parsed = signupSchema.parse(req.body);
    const { name, email, password, role } = parsed;
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rowCount) return res.status(409).json({ error: 'Email already registered' });
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const info = await pool.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role', [name.trim(), email.toLowerCase(), password_hash, role]);
    const user = info.rows[0];
    const token = signToken({ id: user.id });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err instanceof z.ZodError || err.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: err.errors });
    req.log.error(err, "Signup error occurred");
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const row = await pool.query('SELECT id, name, email, password_hash, role FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!row.rowCount) return res.status(401).json({ error: 'Invalid email or password' });
    const user = row.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    const token = signToken({ id: user.id });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    if (err instanceof z.ZodError || err.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: err.errors });
    req.log.error(err, "Login error occurred");
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/ready', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ready: true }); } catch (err) { res.status(503).json({ ready: false }); }
});

app.post('/api/rfqs', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (user.role !== 'buyer') return res.status(403).json({ error: 'Only buyers can create RFQs' });
    const parsed = rfqCreateSchema.parse(req.body);
    const { product_name, description, quantity, delivery_location, deadline } = parsed;
    const info = await pool.query(`INSERT INTO rfqs (buyer_id, product_name, description, quantity, delivery_location, deadline)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [user.id, product_name.trim(), description.trim(), Number(quantity), delivery_location.trim(), deadline]);
    res.status(201).json(info.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError || err.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: err.errors });
    req.log.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/rfqs', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (user.role === 'buyer') {
      const rows = await pool.query('SELECT * FROM rfqs WHERE buyer_id = $1 ORDER BY created_at DESC', [user.id]);
      return res.json(rows.rows);
    }
    const search = (req.query.search || '').trim();
    const location = (req.query.location || '').trim();
    let sql = `SELECT rfqs.*, users.name as buyer_name FROM rfqs JOIN users ON users.id = rfqs.buyer_id WHERE status = 'open'`;
    const params = [];
    if (search) { params.push(`%${search}%`, `%${search}%`); sql += ` AND (product_name ILIKE $${params.length - 1} OR description ILIKE $${params.length})`; }
    if (location) { params.push(`%${location}%`); sql += ` AND delivery_location ILIKE $${params.length}`; }
    sql += ' ORDER BY created_at DESC';
    const rows = await pool.query(sql, params);
    res.json(rows.rows);
  } catch (err) { if (err instanceof z.ZodError || err.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: err.errors }); req.log.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/rfqs/:id', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const id = Number(req.params.id);
    const row = await pool.query(`SELECT rfqs.*, users.name as buyer_name FROM rfqs JOIN users ON users.id = rfqs.buyer_id WHERE rfqs.id = $1`, [id]);
    if (!row.rowCount) return res.status(404).json({ error: 'RFQ not found' });
    const rfq = row.rows[0];
    if (user.role === 'buyer' && rfq.buyer_id !== user.id) return res.status(403).json({ error: 'Not your RFQ' });
    res.json(rfq);
  } catch (err) { req.log.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/rfqs/:id', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const id = Number(req.params.id);
    const rfqRow = await pool.query('SELECT * FROM rfqs WHERE id = $1', [id]);
    if (!rfqRow.rowCount) return res.status(404).json({ error: 'RFQ not found' });
    const rfq = rfqRow.rows[0];
    if (rfq.buyer_id !== user.id) return res.status(403).json({ error: 'Not your RFQ' });

    const parsed = rfqUpdateSchema.parse(req.body || {});
    const product_name = parsed.product_name ? String(parsed.product_name).trim() : rfq.product_name;
    const description = parsed.description ? String(parsed.description).trim() : rfq.description;
    const quantity = parsed.quantity !== undefined ? Number(parsed.quantity) : rfq.quantity;
    const delivery_location = parsed.delivery_location ? String(parsed.delivery_location).trim() : rfq.delivery_location;
    const deadline = parsed.deadline ? parsed.deadline : rfq.deadline;
    const status = parsed.status ? parsed.status : rfq.status;

    await pool.query(`UPDATE rfqs SET product_name=$1, description=$2, quantity=$3, delivery_location=$4, deadline=$5, status=$6 WHERE id=$7`, [product_name, description, quantity, delivery_location, deadline, status, id]);
    const updated = await pool.query('SELECT * FROM rfqs WHERE id = $1', [id]);
    res.json(updated.rows[0]);
  } catch (err) { req.log.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/rfqs/:id', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const id = Number(req.params.id);
    const rfqRow = await pool.query('SELECT * FROM rfqs WHERE id = $1', [id]);
    if (!rfqRow.rowCount) return res.status(404).json({ error: 'RFQ not found' });
    const rfq = rfqRow.rows[0];
    if (rfq.buyer_id !== user.id) return res.status(403).json({ error: 'Not your RFQ' });
    await pool.query('DELETE FROM quotations WHERE rfq_id = $1', [id]);
    await pool.query('DELETE FROM rfqs WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/rfqs/:id/quotations', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (user.role !== 'supplier') return res.status(403).json({ error: 'Only suppliers can submit quotations' });
    const id = Number(req.params.id);
    const rfqRow = await pool.query('SELECT * FROM rfqs WHERE id = $1', [id]);
    if (!rfqRow.rowCount) return res.status(404).json({ error: 'RFQ not found' });
    const rfq = rfqRow.rows[0];
    if (rfq.status !== 'open') return res.status(400).json({ error: 'This RFQ is closed for quotations' });

    const parsed = quotationSchema.parse(req.body || {});
    const { price, delivery_time, notes } = parsed;

    const already = await pool.query('SELECT id FROM quotations WHERE rfq_id = $1 AND supplier_id = $2', [id, user.id]);
    if (already.rowCount) return res.status(409).json({ error: 'You already submitted a quotation for this RFQ' });

    const info = await pool.query('INSERT INTO quotations (rfq_id, supplier_id, price, delivery_time, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id, user.id, Number(price), String(delivery_time).trim(), (notes || '').trim()]);
    res.status(201).json(info.rows[0]);
  } catch (err) { req.log.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/rfqs/:id/quotations', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const id = Number(req.params.id);
    const rfqRow = await pool.query('SELECT * FROM rfqs WHERE id = $1', [id]);
    if (!rfqRow.rowCount) return res.status(404).json({ error: 'RFQ not found' });
    const rfq = rfqRow.rows[0];
    if (rfq.buyer_id !== user.id) return res.status(403).json({ error: 'Not your RFQ' });
    const rows = await pool.query(`SELECT quotations.*, users.name as supplier_name, users.email as supplier_email
      FROM quotations JOIN users ON users.id = quotations.supplier_id
      WHERE rfq_id = $1 ORDER BY price ASC`, [id]);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/quotations/mine', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (user.role !== 'supplier') return res.status(403).json({ error: 'Only suppliers have submitted quotations' });
    const rows = await pool.query(`SELECT quotations.*, rfqs.product_name, rfqs.status as rfq_status, rfqs.delivery_location, rfqs.deadline
      FROM quotations JOIN rfqs ON rfqs.id = quotations.rfq_id
      WHERE supplier_id = $1 ORDER BY quotations.created_at DESC`, [user.id]);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

app.use((err, req, res, next) => {
  req.log.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Startup sequence
async function start() {
  await ensureSchema();
  const server = app.listen(PORT, () => logger.info(`Server listening on http://localhost:${PORT}`));

  const shutdown = async () => {
    logger.info('Shutting down');
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException — exiting');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
});

if (require.main === module) {
  start().catch(err => { logger.error(err); process.exit(1); });
}

module.exports = { app, pool };