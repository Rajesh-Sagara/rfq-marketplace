# Mini B2B RFQ Marketplace

A minimal B2B Request-for-Quotation marketplace: buyers post RFQs, suppliers browse and submit quotations. This repository contains a small Express backend and a single-file SPA in `public/`.

## Tech stack
- Runtime: Node.js 18+ / 22 recommended
- Backend: Express
- Database: Postgres (recommended) — local Docker Compose included
- Auth: JWT (signed tokens) + password hashing (bcrypt)
- Validation: `zod` server-side
- Logging: `pino`

This repo is intended as a lightweight starting point for a production service; it includes sensible defaults (rate limiting, helmet, structured logging, input validation) but is not a complete enterprise-grade distribution out-of-the-box.

## Quick start (local, development)
1. Copy the example env and edit secrets:

```powershell
cp example.env .env
# or on Windows PowerShell
Copy-Item example.env .env
```

2. (Optional) Run Postgres via Docker Compose for local development:

```bash
docker compose up -d
```

3. Install dependencies and run migrations:

```powershell
npm install
npm run migrate
```

4. Start the app:

```powershell
npm run dev
# or
node server.js
```

The API will be available at `http://localhost:3000` by default.

## Environment variables
Required (set in `.env`):
- `JWT_SECRET` — strong random secret for signing tokens
- `DATABASE_URL` — Postgres connection string e.g. `postgres://postgres:postgres@localhost:5432/rfq_dev`
Optional:
- `PORT` (default 3000)
- `LOG_LEVEL` (default `info`)
- `DB_PATH` (SQLite fallback path; only used if `DATABASE_URL` is not set)

Use `example.env` as a template; never commit your real `.env` to source control.

## Security & hardening notes
This project includes a number of built-in protections. Key points and recommendations before publishing on GitHub or deploying:

- Input validation: All request bodies/params are validated with `zod` to ensure correct types and to mitigate logic-based injection vectors.
- Parameterized queries: All DB access uses parameterized queries via `pg` to avoid SQL injection.
- Rate limiting: `express-rate-limit` is enabled to prevent brute-force and abusive traffic. Tune `windowMs` and `max` for your expected usage.
- Request size limits: `express.json({ limit: '1mb' })` is set. Lower this if you don't accept larger payloads.
- Security headers: `helmet()` is configured to set common headers, including a strict Content Security Policy (CSP) to protect the frontend.
- TLS: Run behind a TLS-terminating reverse proxy (Cloud load balancer / NGINX) and never expose the service directly over plain HTTP in production.
- Tokens & cookies: JWTs are short-lived (1h). Consider refresh tokens with rotation/revocation for real production.
- Secrets: Use a secret manager (AWS Secrets Manager, Azure Key Vault, etc.) in production — do not store secrets in the repo or in container images.
- Account protections: Add brute-force protections and optional account lockouts on repeated failed logins.

## Observability
- Structured logging: `pino` is used. Logs include request context via `pino-http`.
- Health & readiness endpoints: `/health` and `/ready` exist for container orchestration and load balancers.
- Metrics & tracing: For production, add Prometheus metrics (export counters/histograms) and optionally OpenTelemetry traces.

## Error handling & reliability
- Centralized error middleware returns safe error messages to clients while logging full details.
- Graceful shutdown handles `SIGINT`/`SIGTERM` and closes DB connections.
- Add process monitoring (systemd, Kubernetes liveness/readiness probes, or a process supervisor) in production.

## Testing & CI
- API integration tests are implemented using `jest` and `supertest`. Run them via `npm test`.
- A GitHub Actions workflow is included to automatically run tests on push and pull requests (`.github/workflows/ci.yml`).


## Database migrations & production readiness
- Schema creation has been decoupled from app startup. Migrations are managed by `migrate.js` and stored in the `migrations/` directory. Run `npm run migrate` to apply new migrations before starting the application. For enterprise-scale production, you may still consider adopting a more robust migration tool (like `node-pg-migrate`, `knex`, or `Flyway`).

## Deploying (Docker)
- A `Dockerfile` and `docker-compose.yml` are included for local testing. For production, build an image using the `Dockerfile`, push to a registry, and run in your orchestration platform.

## Contributing
- When opening PRs, avoid committing secrets. Use `example.env` as a template.

## License
- MIT

