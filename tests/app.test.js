const request = require('supertest');
const { app, pool } = require('../server');
const { execSync } = require('child_process');
const path = require('path');

beforeAll(async () => {
  // Run migrations
  execSync('node migrate.js', { cwd: path.join(__dirname, '..'), env: process.env });
});

afterAll(async () => {
  // Close the database connection pool after all tests
  await pool.end();
});

describe('App Endpoints', () => {
  it('GET /health should return status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  it('GET /ready should return ready true', async () => {
    const res = await request(app).get('/ready');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('ready', true);
  });

  it('POST /api/auth/signup should require fields', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({});
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error', 'Validation failed');
  });
});
