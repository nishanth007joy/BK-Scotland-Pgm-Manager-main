# CLAUDE.md — BK Scotland Programme Manager

## Commands

```bash
# Start the server (reads .env automatically)
npm start

# Run tests
node --test tests/

# Apply schema migrations (requires Liquibase on PATH and Java)
npm run migrate
# or directly:
liquibase --changeLogFile=liquibase/changelog/db.changelog-master.xml update
```

## Architecture

Node.js + Express 5 backend serving a single-page frontend from `public/`. No build step — vanilla JS in the browser.

**Database**: PostgreSQL 16 (was MSSQL). All DB access goes through `db.js` — never import `pg` directly in route files.

**Schema management**: Liquibase SQL-format changelogs in `liquibase/changelog/changes/`. The master changelog is `liquibase/changelog/db.changelog-master.xml`. Each changeset file uses `--liquibase formatted sql` / `--changeset author:id` / `--rollback` markers.

**Route files**: Each feature area registers its own routes via `module.exports = function(app, { db, dbReady, authMiddleware, ... })`. All are loaded from `Server.js`.

## Database patterns (`db.js`)

### Named parameters
All queries use `@name` placeholders — `db.js` converts them to positional `$1, $2, ...` before sending to `pg`. Repeated occurrences of the same name reuse the same slot.

```js
const result = await db.query(
  'SELECT * FROM contestants WHERE id = @id AND mission = @mission',
  { id: 'C1', mission: 'SomeChurch' }
);
// result.recordset — array of rows
// result.rowCount  — rows affected (INSERT/UPDATE/DELETE) or returned (SELECT)
```

### Transactions
```js
await db.withTransaction(async (tq) => {
  // tq has the same signature as db.query
  const row = await tq('SELECT * FROM events WHERE event_id = @id FOR UPDATE', { id });
  await tq('UPDATE events SET event_name = @name WHERE event_id = @id', { name, id });
});

// With explicit isolation level:
await db.withTransaction(async (tq) => { ... }, 'SERIALIZABLE');

// Pool client for SERIALIZABLE multi-query flows (e.g. admin-event-name-routes.js):
const client = await db.pool.connect();
```

### Column aliases
DB columns are `snake_case`. SELECT statements alias them to the PascalCase names the frontend expects, keeping the API surface unchanged:
```sql
SELECT id AS "ContestantID", first_name AS "FirstName" FROM contestants
```

### Error handling
```js
const ce = db.getCustomError(error);   // extracts { number, message } from '[51001] text' PL/pgSQL exceptions
const en = db.errorNumber(error);      // returns numeric code (custom number OR mapped pg error code)
```

## Custom SQL error numbers

| Number | Trigger/source | Meaning |
|--------|---------------|---------|
| 51001  | `uq_events_identity` unique index violation guard | Duplicate event |
| 51002  | `uq_contestants_name_mission` guard | Duplicate contestant name+mission |
| 51003  | `uq_contestants_chest` guard | Duplicate chest number |
| 51004  | `check_individual_registration_limit` trigger | >3 individual event registrations |
| 51005  | `check_group_registration_limit` trigger | >3 group event registrations |
| 51060  | Application code (`Object.assign(new Error('[51060] ...'), {})`) | Optimistic-lock / stale data conflict |
| 51063  | Application code | Group already has results |
| 51070  | Application code | User not found (password reset) |
| 51404  | Application code | Certificate: published result not found |
| 51409  | Application code | Certificate: already printed |

## Schema highlights

### `participants` supertype
Both `contestants` and `group_contestants` have their `id` FK to `participants(id)`. All result tables (`event_registrations`, `prepub_results`, `published_results`) also FK to `participants(id)`, so a single FK covers both individual and group contestants without ambiguity.

ID conventions:
- Individual contestants: `C` + sequence (e.g. `C1`, `C42`)
- Group contestants: `G` + sequence (e.g. `G1`, `G100`)

Two-step INSERT is required for both:
```js
await tq("INSERT INTO participants (id, participant_type) VALUES (@id, 'individual')", { id });
await tq('INSERT INTO contestants (id, ...) VALUES (@id, ...)', { id, ... });
```

### Snapshot denormalization
`event_registrations`, `prepub_results`, and `published_results` intentionally store copies of contestant/event name fields at the time of registration. No cascades — updates to source tables do not propagate (handled explicitly in admin routes when needed).

### Unique indexes (replaced triggers)
- `uq_events_identity` — case-insensitive trimmed (event_name, individual_group, on_stage_off_stage, event_age_group)
- `uq_contestants_name_mission` — case-insensitive trimmed (first_name, last_name, mission)
- `uq_contestants_onstage_chest` / `uq_contestants_offstage_chest` — trimmed chest numbers
- `uq_group_contestants` — (event_id, group_leader_id)

### `publish_winners()` function
Publishing results calls the DB function directly — no large SQL string in application code:
```js
await tq('SELECT publish_winners(@eventId, @ageGroup, @username, @approvedAt)', params);
```

## Test patterns

Tests in `tests/` are Node `node:test` style. Integration tests (`.integration.js`) spin up a real PostgreSQL database. Unit tests mock `db` inline.

Run a single test file:
```bash
node --test tests/results-entry.integration.js
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `pgrm_user` | PostgreSQL user |
| `DB_PASSWORD` | *(required)* | PostgreSQL password |
| `DB_NAME` | `bk_scotland` | Database name |
| `SESSION_SECRET` | *(required in prod)* | express-session secret |
| `PORT` | `3000` | HTTP listen port |

Copy `.env.example` to `.env` for local development.

## Docker

```bash
docker compose up -d   # starts PostgreSQL 16 on localhost:5432
docker compose down    # stop
```

The compose file uses `DB_PASSWORD` from `.env` (default: `LocalDev!2026Pg`).
