const ageCategoryOrder = require('./age-category-order');
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const db = require('./db');
const { isResultboard, restrictResultboard } = require('./resultboard-access');

// Also load configuration when Server.js is launched directly from an IDE.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const app = express();
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const activeSessions = require('./single-session')(SESSION_TIMEOUT_MS);
const PORT = Number(process.env.PORT) || 3000;

// Migrations are managed by Liquibase; run `npm run migrate` before starting the server.
const dbReady = Promise.resolve();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace-this-development-session-secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TIMEOUT_MS },
}));

// Validate every authenticated request, including routes using requireAdmin.
app.use((req, res, next) => {
  if (!req.session.username || isResultboard(req.session)) return next();
  if (activeSessions.touch(req.session.accountKey, req.session.loginToken)) return next();
  req.session.destroy(() => {});
  res.clearCookie('connect.sid');
  return res.status(401).json({ message: 'Your session expired. Please sign in again.' });
});

app.use(restrictResultboard);
app.use(express.static(path.join(__dirname, 'public')));

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function passwordMatches(password, storedHash) {
  const [algorithm, salt, hash] = (storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const saved = Buffer.from(hash, 'hex');
  return saved.length === candidate.length && crypto.timingSafeEqual(saved, candidate);
}

function authMiddleware(req, res, next) {
  if (req.session.username) return next();
  return res.status(401).json({ message: 'Please sign in first.' });
}

function isAdmin(req) {
  return req.session.role === 'admin' && !isResultboard(req.session);
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.status(403).json({ message: 'Administrator access is required.' });
}

require('./admin-contestant-routes')(app, { db, dbReady, requireAdmin });
require('./admin-event-name-routes')(app, { db, dbReady, requireAdmin });
require('./delete-user-routes')(app, { db, dbReady, requireAdmin, activeSessions });

app.post('/login', async (req, res) => {
  const account = String(req.body.username || req.body.email || '').trim();
  const password = String(req.body.password || '');
  if (!account) return res.status(400).json({ message: 'Username or email is required.' });
  let claimedAccount, claimedToken;

  try {
    await dbReady;
    const result = await db.query(
      'SELECT name, email, password_hash, role FROM users WHERE email = @account OR name = @account LIMIT 1',
      { account }
    );
    const user = result.recordset[0];
    const boardAccount = user && isResultboard({ username: user.name, role: user.role });
    if (!user || (!boardAccount && (!password || !passwordMatches(password, user.password_hash)))) {
      return res.status(401).json({ message: 'Invalid credentials!' });
    }
    const accountKey = String(user.email || user.name).trim().toLowerCase();
    if (req.session.username) {
      if (req.session.accountKey !== accountKey) {
        return res.status(409).json({ message: 'Log out before signing in as another user.' });
      }
      return res.json({ message: 'You are already signed in.',
        user: { name: req.session.username, email: user.email, role: req.session.role, isAdmin: isAdmin(req) } });
    }
    const loginToken = crypto.randomBytes(32).toString('hex');
    if (!boardAccount && !activeSessions.claim(accountKey, loginToken)) {
      return res.status(409).json({ message: 'This user is already logged in another session. Log out there, ask an administrator to release the session, or wait for 30 minutes of inactivity before signing in again.' });
    }
    claimedAccount = accountKey;
    claimedToken = loginToken;
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.accountKey = accountKey;
    req.session.loginToken = loginToken;
    req.session.username = user.name || user.email;
    req.session.role = user.role;
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    return res.json({
      message: `Welcome, ${req.session.username}! You are logged in.`,
      user: { name: req.session.username, email: user.email, role: user.role, isAdmin: isAdmin(req) },
    });
  } catch (error) {
    if (claimedToken) activeSessions.release(claimedAccount, claimedToken);
    if (claimedToken && req.session) req.session.destroy(() => {});
    console.error('Login database error:', error);
    return res.status(500).json({ message: 'Unable to log in right now.' });
  }
});

require('./reset-data-routes')(app, { db, dbReady, requireAdmin, activeSessions });
require('./password-reset-routes')(app, { db, dbReady, requireAdmin, hashPassword, activeSessions });

app.get('/api/admin/sessions', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ sessions: activeSessions.list().map(entry => ({ ...entry, current: entry.account === req.session.accountKey })) });
});

app.post('/api/admin/sessions/release', requireAdmin, (req, res) => {
  const { account, id } = req.body || {};
  if (typeof account !== 'string' || typeof id !== 'string')
    return res.status(400).json({ message: 'Select a session to release.' });
  if (account === req.session.accountKey)
    return res.status(400).json({ message: 'Use Logout to end your own session.' });
  if (!activeSessions.revoke(account, id))
    return res.status(409).json({ message: 'This session has ended or changed. Refresh the list.' });
  return res.json({ message: 'Session released. The user can sign in again now.' });
});

app.post('/api/admin/registration-access', requireAdmin, (req, res) => {
  res.json({ allowed: true });
});

app.post('/api/session', authMiddleware, (req, res) => {
  res.json({ name: req.session.username, role: req.session.role, isAdmin: isAdmin(req) });
});

// Also used by the public sign-in page; expose only the display name.
app.get('/api/current-event', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await dbReady;
    const result = await db.query('SELECT current_event_name AS "CurrentEventName" FROM current_event WHERE id = 1');
    if (!result.recordset.length) return res.status(404).json({ message: 'Current event is not configured.' });
    return res.json({ currentEventName: result.recordset[0].CurrentEventName });
  } catch (error) {
    console.error('Current-event database error:', error);
    return res.status(500).json({ message: 'Unable to load current event.' });
  }
});

app.put('/api/current-event', requireAdmin, async (req, res) => {
  const value = req.body?.currentEventName;
  const currentEventName = typeof value === 'string' ? value.trim() : '';
  if (!currentEventName || currentEventName.length > 200) {
    return res.status(400).json({ message: 'Enter a current event name between 1 and 200 characters.' });
  }
  try {
    await dbReady;
    const result = await db.query(
      'UPDATE current_event SET current_event_name = @currentEventName WHERE id = 1 RETURNING current_event_name AS "CurrentEventName"',
      { currentEventName }
    );
    if (!result.recordset.length) return res.status(404).json({ message: 'Current event is not configured.' });
    return res.json({ message: 'Current event name saved.', currentEventName: result.recordset[0].CurrentEventName });
  } catch (error) {
    console.error('Current-event update error:', error);
    return res.status(500).json({ message: 'Unable to save current event name.' });
  }
});

app.post('/api/missions', authMiddleware, async (req, res) => {
  try {
    await dbReady;
    const result = await db.query('SELECT mission_name AS name, region FROM missions ORDER BY mission_name');
    return res.json({ missions: result.recordset });
  } catch (error) {
    console.error('List-missions database error:', error);
    return res.status(500).json({ message: 'Unable to load missions.' });
  }
});

app.post('/api/age-categories', authMiddleware, async (req, res) => {
  try {
    await dbReady;
    const result = await db.query(
      `SELECT age_range AS name FROM age_categories ORDER BY ${ageCategoryOrder('age_range')}, age_range, agid`
    );
    return res.json({ ageCategories: result.recordset });
  } catch (error) {
    console.error('List-age-categories database error:', error);
    return res.status(500).json({ message: 'Unable to load age ranges.' });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  if (!name || !email || password.length < 8) {
    return res.status(400).json({ message: 'Name, email, and a password of at least 8 characters are required.' });
  }

  const role = name.toLowerCase() === 'resultboard' ? 'resultboard' : (req.body.role ?? 'data-entry');
  if (!['admin', 'data-entry', 'resultboard'].includes(role)) {
    return res.status(400).json({ message: 'Select Admin, Data entry, or Results board as the user role.' });
  }

  try {
    await dbReady;
    const existing = await db.query('SELECT email FROM users WHERE email = @email LIMIT 1', { email });
    if (existing.recordset.length) return res.status(409).json({ message: 'A user with that email already exists.' });
    await db.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (@name, @email, @passwordHash, @role)',
      { name, email, passwordHash: hashPassword(password), role }
    );
    return res.status(201).json({ message: 'User created.' });
  } catch (error) {
    console.error('Create-user database error:', error);
    return res.status(500).json({ message: 'Database error.' });
  }
});

app.get('/api/contestants', authMiddleware, async (req, res) => {
  try {
    await dbReady;
    const result = await db.query(`
      SELECT id AS "ContestantID", first_name AS "FirstName", last_name AS "LastName",
        age_group AS "AgeGroup", mission AS "Mission", region AS "Region",
        TRIM(on_stage_chest_no) AS "OnStageChestNo", TRIM(off_stage_chest_no) AS "OffStageChestNo",
        comments AS "Comments"
      FROM contestants ORDER BY first_name, last_name, id
    `);
    return res.json({ contestants: result.recordset });
  } catch (error) {
    console.error('List-contestants database error:', error);
    return res.status(500).json({ message: 'Unable to load contestants.' });
  }
});

app.get('/api/contestants/:id', authMiddleware, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id || id.length > 50) return res.status(400).json({ message: 'Select a valid contestant ID.' });
  try {
    await dbReady;
    const result = await db.query(`
      SELECT id AS "ContestantID", first_name AS "FirstName", last_name AS "LastName",
        age_group AS "AgeGroup", mission AS "Mission", region AS "Region",
        TRIM(on_stage_chest_no) AS "OnStageChestNo", TRIM(off_stage_chest_no) AS "OffStageChestNo",
        comments AS "Comments"
      FROM contestants WHERE id = @id
    `, { id });
    if (result.recordset.length !== 1) return res.status(404).json({ message: 'Contestant not found.' });
    return res.json({ contestant: result.recordset[0] });
  } catch (error) {
    console.error('Load-contestant database error:', error);
    return res.status(500).json({ message: 'Unable to load contestant details.' });
  }
});

app.put('/api/contestants/:id', authMiddleware, async (req, res) => {
  const id = String(req.params.id || '').trim();
  const fields = ['FirstName', 'LastName', 'AgeGroup', 'Mission', 'Region', 'OnStageChestNo', 'OffStageChestNo', 'Comments'];
  const dbCols = { FirstName: 'first_name', LastName: 'last_name', AgeGroup: 'age_group',
    Mission: 'mission', Region: 'region', OnStageChestNo: 'on_stage_chest_no',
    OffStageChestNo: 'off_stage_chest_no', Comments: 'comments' };
  const original = req.body?.Original;
  if (!id || id.length > 50 || !original || typeof original !== 'object')
    return res.status(400).json({ message: 'Reload the contestant before editing.' });
  const updated = {};
  const previous = {};
  for (const field of fields) {
    if (req.body?.[field] != null && typeof req.body[field] !== 'string')
      return res.status(400).json({ message: `${field} must be text.` });
    if (original[field] != null && typeof original[field] !== 'string')
      return res.status(400).json({ message: 'Reload the contestant before editing.' });
    updated[field] = String(req.body?.[field] || '').trim();
    previous[field] = String(original[field] || '').trim();
    const limit = ['OnStageChestNo', 'OffStageChestNo'].includes(field) ? 10 : 50;
    if (updated[field].length > limit || previous[field].length > limit)
      return res.status(400).json({ message: `${field} is too long.` });
  }
  if (['FirstName', 'LastName', 'AgeGroup', 'Mission', 'Region'].some(f => !updated[f]))
    return res.status(400).json({ message: 'First name, last name, age range, mission, and region are required.' });
  try {
    await dbReady;
    await db.withTransaction(async (tq) => {
      // Optimistic concurrency: only update if all original values still match
      const upd = await tq(`
        UPDATE contestants SET
          first_name = @firstName, last_name = @lastName, age_group = @ageGroup,
          mission = @mission, region = @region,
          on_stage_chest_no = @onStageChestNo, off_stage_chest_no = @offStageChestNo,
          comments = @comments
        WHERE id = @id
          AND first_name = @origFirstName AND last_name = @origLastName
          AND age_group = @origAgeGroup AND mission = @origMission AND region = @origRegion
          AND COALESCE(TRIM(on_stage_chest_no), '') = COALESCE(@origOnStageChestNo, '')
          AND COALESCE(TRIM(off_stage_chest_no), '') = COALESCE(@origOffStageChestNo, '')
          AND COALESCE(comments, '') = COALESCE(@origComments, '')
        RETURNING id
      `, {
        id,
        firstName: updated.FirstName, lastName: updated.LastName, ageGroup: updated.AgeGroup,
        mission: updated.Mission, region: updated.Region,
        onStageChestNo: updated.OnStageChestNo || null, offStageChestNo: updated.OffStageChestNo || null,
        comments: updated.Comments || null,
        origFirstName: previous.FirstName, origLastName: previous.LastName, origAgeGroup: previous.AgeGroup,
        origMission: previous.Mission, origRegion: previous.Region,
        origOnStageChestNo: previous.OnStageChestNo || null, origOffStageChestNo: previous.OffStageChestNo || null,
        origComments: previous.Comments || null,
      });
      if (!upd.rowCount) {
        const exists = await tq('SELECT 1 FROM contestants WHERE id = @id', { id });
        if (!exists.recordset.length) throw Object.assign(new Error('[51060] Contestant not found.'), {});
        throw Object.assign(new Error('[51060] Contestant details changed or the ID is missing. Reload before saving.'), {});
      }

      // Validate chest numbers still cover pending registrations
      const missing = await tq(`
        SELECT 1 FROM event_registrations er
        WHERE er.contestant_id = @id
          AND NOT EXISTS (
            SELECT 1 FROM prepub_results p
            WHERE p.event_id = er.event_id AND p.event_age_group = er.event_age_group
              AND p.checked_approved = 'approved'
          )
          AND NULLIF(TRIM(
            CASE LOWER(REPLACE(REPLACE(TRIM(er.on_stage_off_stage), ' ', ''), '-', ''))
              WHEN 'onstage' THEN @onStageChestNo WHEN 'offstage' THEN @offStageChestNo
            END
          ), '') IS NULL
        LIMIT 1
      `, { id, onStageChestNo: updated.OnStageChestNo || null, offStageChestNo: updated.OffStageChestNo || null });
      if (missing.recordset.length)
        throw Object.assign(new Error('[51061] A pending registration needs its stage chest number. Keep that number or resolve the registration.'), {});

      // Cascade name/mission/chest updates to unresolved registrations
      await tq(`
        UPDATE event_registrations SET
          contestant_first_name = @firstName, contestant_last_name = @lastName,
          contestant_mission = @mission,
          chest_no = CASE LOWER(REPLACE(REPLACE(TRIM(on_stage_off_stage), ' ', ''), '-', ''))
            WHEN 'onstage' THEN @onStageChestNo WHEN 'offstage' THEN @offStageChestNo END
        WHERE contestant_id = @id
          AND NOT EXISTS (
            SELECT 1 FROM prepub_results p
            WHERE p.event_id = event_registrations.event_id
              AND p.event_age_group = event_registrations.event_age_group
              AND p.checked_approved = 'approved'
          )
      `, { id, firstName: updated.FirstName, lastName: updated.LastName, mission: updated.Mission,
           onStageChestNo: updated.OnStageChestNo || null, offStageChestNo: updated.OffStageChestNo || null });

      // Sync pre-publication result snapshot for unapproved rows
      await tq(`
        UPDATE prepub_results pr SET
          contestant_first_name = er.contestant_first_name,
          contestant_last_name = er.contestant_last_name,
          contestant_mission = er.contestant_mission,
          chest_no = er.chest_no
        FROM event_registrations er
        WHERE er.event_id = pr.event_id AND er.contestant_id = pr.contestant_id
          AND er.event_age_group = pr.event_age_group
          AND pr.contestant_id = @id AND pr.checked_approved = 'not approved'
      `, { id });
    });
    return res.json({ message: 'Contestant details saved.' });
  } catch (error) {
    const en = db.errorNumber(error);
    if ([51060, 51061, 51062].includes(en))
      return res.status(409).json({ message: db.getCustomError(error)?.message || error.message });
    if (en === 23505) return res.status(409).json({ message: error.message });
    console.error('Edit-contestant database error:', error);
    return res.status(500).json({ message: 'Unable to save contestant details.' });
  }
});

app.post('/api/contestants', authMiddleware, async (req, res) => {
  const contestant = {
    firstName: String(req.body.firstName || '').trim(),
    lastName: String(req.body.lastName || '').trim(),
    ageGroup: String(req.body.ageGroup || '').trim(),
    mission: String(req.body.mission || '').trim(),
    region: String(req.body.region || '').trim(),
    onStageChestNo: String(req.body.onStageChestNo || '').trim() || null,
    offStageChestNo: String(req.body.offStageChestNo || '').trim() || null,
    comments: String(req.body.comments || '').trim() || null,
  };
  const requiredValues = [contestant.firstName, contestant.lastName, contestant.ageGroup, contestant.mission, contestant.region];
  if (req.body.isGroupContestant !== true && !contestant.onStageChestNo && !contestant.offStageChestNo) {
    return res.status(400).json({ message: 'Enter at least one on-stage or off-stage chest number when Group contestant is not selected.' });
  }
  if (requiredValues.some(v => !v)) {
    return res.status(400).json({ message: 'First name, last name, age group, mission, and region are required.' });
  }
  if (contestant.firstName.length > 50 || contestant.lastName.length > 50 || contestant.ageGroup.length > 50
    || contestant.mission.length > 50 || contestant.region.length > 50
    || (contestant.onStageChestNo && contestant.onStageChestNo.length > 10)
    || (contestant.offStageChestNo && contestant.offStageChestNo.length > 10)
    || (contestant.comments && contestant.comments.length > 50)) {
    return res.status(400).json({ message: 'One or more fields exceed the database column length.' });
  }
  try {
    await dbReady;
    const result = await db.withTransaction(async (tq) => {
      const seqRow = await tq("SELECT nextval('contestant_id_seq') AS seq");
      const newId = 'C' + seqRow.recordset[0].seq;
      await tq("INSERT INTO participants (id, participant_type) VALUES (@id, 'individual')", { id: newId });
      return tq(`
        INSERT INTO contestants (id, first_name, last_name, age_group, mission, region,
          on_stage_chest_no, off_stage_chest_no, comments)
        VALUES (@id, @firstName, @lastName, @ageGroup, @mission, @region,
          @onStageChestNo, @offStageChestNo, @comments)
        RETURNING id, TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
      `, {
        id: newId,
        firstName: contestant.firstName, lastName: contestant.lastName, ageGroup: contestant.ageGroup,
        mission: contestant.mission, region: contestant.region,
        onStageChestNo: contestant.onStageChestNo, offStageChestNo: contestant.offStageChestNo,
        comments: contestant.comments,
      });
    });
    const { id, createdAt } = result.recordset[0];
    return res.status(201).json({ message: `Contestant saved. ID: ${id}.`, id, createdAt });
  } catch (error) {
    const en = db.errorNumber(error);
    if (en === 23505) {
      if (error.constraint === 'uq_contestants_on_stage_chest')
        return res.status(409).json({ message: 'On-stage chest number already belongs to another contestant. Enter a unique on-stage chest number.' });
      if (error.constraint === 'uq_contestants_off_stage_chest')
        return res.status(409).json({ message: 'Off-stage chest number already belongs to another contestant. Enter a unique off-stage chest number.' });
      return res.status(409).json({ message: 'A contestant with the same first name, last name, age group, and mission already exists. Check the existing record before adding another contestant.' });
    }
    console.error('Create-contestant database error:', error);
    return res.status(500).json({ message: 'Database error.' });
  }
});

const eventSelectCols = `event_id AS "EventID", event_name AS "EventName",
  event_age_group AS "EventAgeGroup", TRIM(individual_group) AS "IndividualGroup",
  TRIM(on_stage_off_stage) AS "OnStageOffStage", comments AS "Comments"`;

app.get('/api/events', authMiddleware, async (req, res) => {
  try {
    await dbReady;
    const result = await db.query(
      `SELECT ${eventSelectCols} FROM events ORDER BY event_name, ${ageCategoryOrder('event_age_group')}, event_age_group, event_id`
    );
    return res.json({ events: result.recordset });
  } catch (error) {
    console.error('List-events database error:', error);
    return res.status(500).json({ message: 'Unable to load events.' });
  }
});

app.get('/api/events/:id', authMiddleware, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id || id.length > 50) return res.status(400).json({ message: 'Select a valid event ID.' });
  try {
    await dbReady;
    const result = await db.query(`SELECT ${eventSelectCols} FROM events WHERE event_id = @id`, { id });
    if (result.recordset.length !== 1) return res.status(404).json({ message: 'Event not found.' });
    return res.json({ event: result.recordset[0] });
  } catch (error) {
    console.error('Load-event database error:', error);
    return res.status(500).json({ message: 'Unable to load event details.' });
  }
});

app.put('/api/events/:id', authMiddleware, async (req, res) => {
  const id = String(req.params.id || '').trim();
  const original = req.body?.Original;
  if (!id || id.length > 50 || !original || typeof original !== 'object')
    return res.status(400).json({ message: 'Reload the event before editing.' });
  const limits = { EventName: 50, EventAgeGroup: 50, IndividualGroup: 10, OnStageOffStage: 10, Comments: 50 };
  const data = {};
  for (const [field, limit] of Object.entries(limits)) {
    if ((req.body[field] != null && typeof req.body[field] !== 'string') ||
        (original[field] != null && typeof original[field] !== 'string'))
      return res.status(400).json({ message: `${field} must be text.` });
    data[field] = String(req.body[field] || '').trim();
    if ((!data[field] && field !== 'Comments') || data[field].length > limit || String(original[field] || '').length > limit)
      return res.status(400).json({ message: `Enter a valid ${field}.` });
  }
  if (!['Individual', 'Group'].includes(data.IndividualGroup) || !['OnStage', 'OffStage'].includes(data.OnStageOffStage))
    return res.status(400).json({ message: 'Select a valid event type and stage.' });
  try {
    await dbReady;
    await db.withTransaction(async (tq) => {
      // Block changes to structural fields if registrations exist
      const hasReg = await tq('SELECT 1 FROM event_registrations WHERE event_id = @id LIMIT 1', { id });
      const orig = original;
      if (hasReg.recordset.length &&
          (data.EventName !== orig.EventName || data.EventAgeGroup !== orig.EventAgeGroup ||
           data.IndividualGroup !== orig.IndividualGroup || data.OnStageOffStage !== orig.OnStageOffStage)) {
        throw Object.assign(new Error('[51061] This event has registrations. Only comments can be changed.'), {});
      }
      const upd = await tq(`
        UPDATE events SET event_name = @eventName, event_age_group = @eventAgeGroup,
          individual_group = @individualGroup, on_stage_off_stage = @onStageOffStage,
          comments = @comments
        WHERE event_id = @id
          AND event_name = @origEventName AND event_age_group = @origEventAgeGroup
          AND individual_group = @origIndividualGroup AND on_stage_off_stage = @origOnStageOffStage
          AND COALESCE(comments, '') = COALESCE(@origComments, '')
        RETURNING event_id
      `, {
        id,
        eventName: data.EventName, eventAgeGroup: data.EventAgeGroup,
        individualGroup: data.IndividualGroup, onStageOffStage: data.OnStageOffStage,
        comments: data.Comments || null,
        origEventName: String(orig.EventName || '').trim(), origEventAgeGroup: String(orig.EventAgeGroup || '').trim(),
        origIndividualGroup: String(orig.IndividualGroup || '').trim(), origOnStageOffStage: String(orig.OnStageOffStage || '').trim(),
        origComments: String(orig.Comments || '').trim() || null,
      });
      if (!upd.rowCount)
        throw Object.assign(new Error('[51060] Event details changed or the ID is missing. Reload before saving.'), {});
    });
    return res.json({ message: 'Event details updated.' });
  } catch (error) {
    const en = db.errorNumber(error);
    const ce = db.getCustomError(error);
    if (ce && [51060, 51061].includes(ce.number)) return res.status(409).json({ message: ce.message });
    if (en === 23505) return res.status(409).json({ message: 'An event with these details already exists.' });
    console.error('Update-event database error:', error);
    return res.status(500).json({ message: 'Unable to update the event.' });
  }
});

app.post('/api/events', authMiddleware, async (req, res) => {
  const textFields = { EventName: 50, EventAgeGroup: 50, IndividualGroup: 10, OnStageOffStage: 10, Comments: 50 };
  const data = {};
  for (const [field, limit] of Object.entries(textFields)) {
    const value = req.body[field];
    if (value != null && typeof value !== 'string') return res.status(400).json({ message: `${field} must be text.` });
    data[field] = (value || '').trim();
    if ((!data[field] && field !== 'Comments') || data[field].length > limit) {
      return res.status(400).json({ message: `${field} ${data[field] ? `must be at most ${limit} characters` : 'is required'}.` });
    }
  }
  try {
    await dbReady;
    const seqRow = await db.query("SELECT nextval('event_id_seq') AS seq");
    const newId = 'E' + seqRow.recordset[0].seq;
    const result = await db.query(`
      INSERT INTO events (event_id, event_name, event_age_group, individual_group, on_stage_off_stage, comments)
      VALUES (@eventId, @eventName, @eventAgeGroup, @individualGroup, @onStageOffStage, @comments)
      RETURNING event_id AS "EventID"
    `, {
      eventId: newId,
      eventName: data.EventName, eventAgeGroup: data.EventAgeGroup,
      individualGroup: data.IndividualGroup, onStageOffStage: data.OnStageOffStage,
      comments: data.Comments || null,
    });
    const eventId = result.recordset[0].EventID;
    return res.status(201).json({ message: `Event saved. ID: ${eventId}.`, EventID: eventId });
  } catch (error) {
    if (db.errorNumber(error) === 23505) {
      return res.status(409).json({ message: 'An event with the same name, age group, individual/group type, and stage already exists.' });
    }
    console.error('Create-event database error:', error);
    return res.status(500).json({ message: 'Unable to save the event.' });
  }
});

app.get('/api/event-registration-options', authMiddleware, async (req, res) => {
  try {
    await dbReady;
    const [eventsResult, contestantsResult] = await Promise.all([
      db.query(`
        SELECT event_id AS "EventID", event_name AS "EventName", event_age_group AS "EventAgeGroup",
          TRIM(individual_group) AS "IndividualGroup", TRIM(on_stage_off_stage) AS "OnStageOffStage"
        FROM events ORDER BY event_name, ${ageCategoryOrder('event_age_group')}, event_age_group, event_id
      `),
      db.query(`
        SELECT id AS "ContestantID", first_name AS "ContestantFirstName",
          last_name AS "ContestantLastName", mission AS "ContestantMission",
          on_stage_chest_no AS "OnStageChestNo", off_stage_chest_no AS "OffStageChestNo",
          age_group AS "AgeGroup"
        FROM contestants ORDER BY first_name, last_name, id
      `),
    ]);
    return res.json({ events: eventsResult.recordset, contestants: contestantsResult.recordset });
  } catch (error) {
    console.error('Registration-options database error:', error);
    return res.status(500).json({ message: 'Unable to load events and contestants. Please reload the page.' });
  }
});

app.post('/api/event-registrations', authMiddleware, async (req, res) => {
  const data = {};
  for (const field of ['EventID', 'ContestantID', 'Comments']) {
    const value = req.body?.[field];
    if (value != null && typeof value !== 'string') return res.status(400).json({ message: `${field} must be text.` });
    data[field] = (value || '').trim();
    if (data[field].length > 50 || (field !== 'Comments' && !data[field])) {
      return res.status(400).json({ message: `${field} is required and must be at most 50 characters (comments are optional).` });
    }
  }
  try {
    await dbReady;
    const inserted = await db.withTransaction(async (tq) => {
      // Copy from source tables in one statement — never trust posted display fields.
      const ins = await tq(`
        INSERT INTO event_registrations
          (event_id, event_name, event_age_group, individual_group, on_stage_off_stage,
           contestant_id, contestant_first_name, contestant_last_name, contestant_mission, chest_no, comments)
        SELECT e.event_id, e.event_name, e.event_age_group, e.individual_group, e.on_stage_off_stage,
          c.id, c.first_name, c.last_name, c.mission,
          CASE LOWER(REPLACE(REPLACE(TRIM(e.on_stage_off_stage), ' ', ''), '-', ''))
            WHEN 'onstage' THEN c.on_stage_chest_no WHEN 'offstage' THEN c.off_stage_chest_no
          END,
          @comments
        FROM events e, contestants c
        WHERE e.event_id = @eventId AND c.id = @contestantId
          AND (LOWER(TRIM(e.individual_group)) <> 'individual'
            OR (TRIM(e.event_age_group) <> ''
              AND LOWER(TRIM(e.event_age_group)) = LOWER(TRIM(c.age_group))))
          AND NULLIF(TRIM(
            CASE LOWER(REPLACE(REPLACE(TRIM(e.on_stage_off_stage), ' ', ''), '-', ''))
              WHEN 'onstage' THEN c.on_stage_chest_no WHEN 'offstage' THEN c.off_stage_chest_no
            END
          ), '') IS NOT NULL
      `, { eventId: data.EventID, contestantId: data.ContestantID, comments: data.Comments || null });
      if (ins.rowCount !== 1) return 0;

      // Enforce individual event limit (max 3) in Node.js
      const limitCheck = await tq(`
        SELECT COUNT(*) AS cnt FROM event_registrations
        WHERE contestant_id = @contestantId AND LOWER(TRIM(individual_group)) = 'individual'
      `, { contestantId: data.ContestantID });
      if (Number(limitCheck.recordset[0].cnt) > 3)
        throw Object.assign(new Error('[51004] A contestant can register for a maximum of 3 individual items across on-stage and off-stage events combined.'), {});

      return 1;
    });

    if (!inserted) {
      return res.status(400).json({ message: 'Select an existing event and contestant with unique IDs, a valid event stage, and a chest number for that stage. Individual events require the contestant and event to have the same age group. Reload the page if their details have changed.' });
    }
    return res.status(201).json({ message: 'Event registration saved.' });
  } catch (error) {
    const en = db.errorNumber(error);
    if (en === 51004) {
      return res.status(409).json({ message: 'This contestant already has 3 individual item registrations. On-stage and off-stage items count toward the same limit.' });
    }
    if (en === 23505) {
      return res.status(409).json({ message: 'This contestant is already registered for this event.' });
    }
    console.error('Create-event-registration database error:', error);
    return res.status(500).json({ message: 'Unable to save the event registration.' });
  }
});

require('./group-contestant-routes')(app, { db, dbReady, authMiddleware });
require('./event-registration-edit-routes')(app, { db, dbReady, authMiddleware });
require('./results-routes')(app, { db, dbReady, authMiddleware, isAdmin });
require('./certificate-routes')(app, { db, dbReady, authMiddleware });

app.post('/logout', (req, res) => {
  const { accountKey, loginToken } = req.session;
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ message: 'Error logging out.' });
    activeSessions.release(accountKey, loginToken);
    res.clearCookie('connect.sid');
    return res.json({ message: 'Logged out successfully.' });
  });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
