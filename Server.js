const ageCategoryOrder = require('./age-category-order');
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const sql = require('mssql');
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
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const sqlConfig = {
  server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
  user: process.env.DB_USER || 'Pgrm_User',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'CSMEGB-Scotland',
  options: { encrypt: false, trustServerCertificate: true },
};

if (!sqlConfig.password) {
  throw new Error('DB_PASSWORD must be set before starting the server.');
}

const db = new sql.ConnectionPool(sqlConfig);
const dbReady = db.connect().then(async () => {
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'current-event.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'contestant-created-at.sql'), 'utf8'));
  await db.request().input('adminUsername', sql.NVarChar(255), ADMIN_USERNAME)
    .query(fs.readFileSync(path.join(__dirname, 'sql', 'user-roles.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'resultboard-role.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'decimal-result-scores.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'result-score-comments.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'walkover-results.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'results-printed.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'group-contestant-events.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'auto-number-group-contestants.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'limit-group-registrations.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'limit-individual-registrations.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'unique-contestant-chest-numbers.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'prevent-duplicate-contestants.sql'), 'utf8'));
  await db.request().query(fs.readFileSync(path.join(__dirname, 'sql', 'prevent-duplicate-group-contestants.sql'), 'utf8'));
});

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

require('./admin-contestant-routes')(app, { db, dbReady, sql, requireAdmin });
require('./admin-event-name-routes')(app, { db, dbReady, sql, requireAdmin });
require('./delete-user-routes')(app, { db, dbReady, sql, requireAdmin, activeSessions });

app.post('/login', async (req, res) => {
  const account = String(req.body.username || req.body.email || '').trim();
  const password = String(req.body.password || '');
  if (!account) return res.status(400).json({ message: 'Username or email is required.' });
  let claimedAccount, claimedToken;

  try {
    await dbReady;
    const result = await db.request()
      .input('account', sql.NVarChar(255), account)
      .query('SELECT TOP (1) name, email, password_hash, role FROM dbo.users WHERE email = @account OR name = @account');
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
require('./password-reset-routes')(app, { db, dbReady, sql, requireAdmin, hashPassword, activeSessions });

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
    const result = await db.request().query('SELECT CurrentEventName FROM dbo.CurrentEvent WHERE ID = 1;');
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
    const result = await db.request()
      .input('currentEventName', sql.NVarChar(200), currentEventName)
      .query('UPDATE dbo.CurrentEvent SET CurrentEventName = @currentEventName OUTPUT INSERTED.CurrentEventName WHERE ID = 1;');
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
    const result = await db.request().query(`
      SELECT MissionName AS name, Region AS region
      FROM dbo.MissionDetails
      ORDER BY MissionName;
    `);
    return res.json({ missions: result.recordset });
  } catch (error) {
    console.error('List-missions database error:', error);
    return res.status(500).json({ message: 'Unable to load missions.' });
  }
});

app.post('/api/age-categories', authMiddleware, async (req, res) => {
  try {
    await dbReady;
    const result = await db.request().query(`
      SELECT AgeRange AS name
      FROM dbo.AgeCategory
      ORDER BY ${ageCategoryOrder('AgeRange')}, AgeRange, AGID;
    `);
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
    const existing = await db.request().input('email', sql.NVarChar(255), email)
      .query('SELECT TOP (1) email FROM dbo.users WHERE email = @email');
    if (existing.recordset.length) return res.status(409).json({ message: 'A user with that email already exists.' });
    await db.request()
      .input('name', sql.NVarChar(255), name)
      .input('email', sql.NVarChar(255), email)
      .input('passwordHash', sql.NVarChar(255), hashPassword(password))
      .input('role', sql.VarChar(20), role)
      .query('INSERT INTO dbo.users (name, email, password_hash, role) VALUES (@name, @email, @passwordHash, @role)');
    return res.status(201).json({ message: 'User created.' });
  } catch (error) {
    console.error('Create-user database error:', error);
    return res.status(500).json({ message: 'Database error.' });
  }
});

app.get('/api/contestants', authMiddleware, async (req, res) => {
  try {
    await dbReady;
    const result = await db.request().query(`SELECT ID AS ContestantID,
      [First Name] AS FirstName, [Last Name] AS LastName, AgeGroup, Mission, Region,
      RTRIM(OnStageChestNo) AS OnStageChestNo, RTRIM(OffStageChestNo) AS OffStageChestNo,
      Comments FROM dbo.Contestants ORDER BY [First Name], [Last Name], ID;`);
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
    const result = await db.request().input('id', sql.NVarChar(50), id).query(`SELECT
      ID AS ContestantID, [First Name] AS FirstName, [Last Name] AS LastName,
      AgeGroup, Mission, Region, RTRIM(OnStageChestNo) AS OnStageChestNo,
      RTRIM(OffStageChestNo) AS OffStageChestNo, Comments
      FROM dbo.Contestants WHERE ID=@id;`);
    if (result.recordset.length !== 1) return res.status(404).json({ message: 'Contestant not found.' });
    return res.json({ contestant: result.recordset[0] });
  } catch (error) {
    console.error('Load-contestant database error:', error);
    return res.status(500).json({ message: 'Unable to load contestant details.' });
  }
});

app.put('/api/contestants/:id', authMiddleware, async (req, res) => {
  const id = String(req.params.id || '').trim();
  const fields = ['FirstName', 'LastName', 'AgeGroup', 'Mission', 'Region',
    'OnStageChestNo', 'OffStageChestNo', 'Comments'];
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
  if (['FirstName', 'LastName', 'AgeGroup', 'Mission', 'Region'].some((field) => !updated[field]))
    return res.status(400).json({ message: 'First name, last name, age range, mission, and region are required.' });
  try {
    await dbReady;
    const request = db.request().input('id', sql.NVarChar(50), id);
    const types = { FirstName: sql.VarChar(50), LastName: sql.VarChar(50),
      AgeGroup: sql.NVarChar(50), Mission: sql.VarChar(50), Region: sql.VarChar(50),
      OnStageChestNo: sql.NChar(10), OffStageChestNo: sql.NChar(10), Comments: sql.VarChar(50) };
    for (const field of fields) {
      request.input(field, types[field], updated[field] || null);
      request.input(`original${field}`, types[field], previous[field] || null);
    }
    await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION;
      BEGIN TRY
        UPDATE dbo.Contestants SET [First Name]=@FirstName, [Last Name]=@LastName,
          AgeGroup=@AgeGroup, Mission=@Mission, Region=@Region,
          OnStageChestNo=@OnStageChestNo, OffStageChestNo=@OffStageChestNo,
          Comments=@Comments
        WHERE ID=@id AND [First Name]=@originalFirstName
          AND [Last Name]=@originalLastName AND AgeGroup=@originalAgeGroup
          AND Mission=@originalMission AND Region=@originalRegion
          AND ISNULL(RTRIM(OnStageChestNo),'')=ISNULL(@originalOnStageChestNo,'')
          AND ISNULL(RTRIM(OffStageChestNo),'')=ISNULL(@originalOffStageChestNo,'')
          AND ISNULL(Comments,'')=ISNULL(@originalComments,'');
        IF @@ROWCOUNT <> 1
          THROW 51060, 'Contestant details changed or the ID is missing. Reload before saving.', 1;
        IF EXISTS (SELECT 1 FROM dbo.EventRegistrations er
          WHERE er.ContestantID=@id
            AND NOT EXISTS (SELECT 1 FROM dbo.PrePubResults p
              WHERE p.EventID=er.EventID AND p.EventAgeGroup=er.EventAgeGroup
                AND p.CheckedApproved='approved')
            AND NULLIF(LTRIM(RTRIM(CASE LOWER(REPLACE(REPLACE(RTRIM(er.OnStageOffStage),' ',''),'-',''))
              WHEN 'onstage' THEN @OnStageChestNo WHEN 'offstage' THEN @OffStageChestNo END)), '') IS NULL)
          THROW 51061, 'A pending registration needs its stage chest number. Keep that number or resolve the registration.', 1;
        UPDATE er SET ContestantFirstName=@FirstName, ContestantLastName=@LastName,
          ContestantMission=@Mission,
          ChestNo=CASE LOWER(REPLACE(REPLACE(RTRIM(er.OnStageOffStage),' ',''),'-',''))
            WHEN 'onstage' THEN @OnStageChestNo WHEN 'offstage' THEN @OffStageChestNo END
        FROM dbo.EventRegistrations er WHERE er.ContestantID=@id
          AND NOT EXISTS (SELECT 1 FROM dbo.PrePubResults p
            WHERE p.EventID=er.EventID AND p.EventAgeGroup=er.EventAgeGroup
              AND p.CheckedApproved='approved');
        UPDATE p SET ContestantFirstName=er.ContestantFirstName,
          ContestantLastName=er.ContestantLastName,
          ContestantMission=er.ContestantMission, ChestNo=er.ChestNo
        FROM dbo.PrePubResults p JOIN dbo.EventRegistrations er
          ON er.EventID=p.EventID AND er.ContestantID=p.ContestantID
          AND er.EventAgeGroup=p.EventAgeGroup
        WHERE p.ContestantID=@id AND p.CheckedApproved='not approved';
        COMMIT TRANSACTION;
      END TRY BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW;
      END CATCH;`);
    return res.json({ message: 'Contestant details saved.' });
  } catch (error) {
    if ([51060, 51061, 51062, 51002, 2601, 2627, 1205].includes(error.number))
      return res.status(409).json({ message: error.message });
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
  if (requiredValues.some((value) => !value)) {
    return res.status(400).json({ message: 'First name, last name, age group, mission, and region are required.' });
  }
  if (contestant.firstName.length > 50 || contestant.lastName.length > 50 || contestant.ageGroup.length > 50 || contestant.mission.length > 50 || contestant.region.length > 50 || (contestant.onStageChestNo && contestant.onStageChestNo.length > 10) || (contestant.offStageChestNo && contestant.offStageChestNo.length > 10) || (contestant.comments && contestant.comments.length > 50)) {
    return res.status(400).json({ message: 'One or more fields exceed the database column length.' });
  }

  try {
    await dbReady;
    const result = await db.request()
      .input('firstName', sql.VarChar(50), contestant.firstName)
      .input('lastName', sql.VarChar(50), contestant.lastName)
      .input('ageGroup', sql.NVarChar(50), contestant.ageGroup)
      .input('mission', sql.VarChar(50), contestant.mission)
      .input('region', sql.VarChar(50), contestant.region)
      .input('onStageChestNo', sql.NChar(10), contestant.onStageChestNo)
      .input('offStageChestNo', sql.NChar(10), contestant.offStageChestNo)
      .input('comments', sql.VarChar(50), contestant.comments)
      .query(`DECLARE @saved TABLE (ID nvarchar(50), CreatedAt datetime2(3));
        INSERT INTO dbo.Contestants
        ([First Name], [Last Name], [AgeGroup], [Mission], [Region], [OnStageChestNo], [OffStageChestNo], [Comments])
        OUTPUT INSERTED.ID, INSERTED.CreatedAt INTO @saved (ID, CreatedAt)
        VALUES (@firstName, @lastName, @ageGroup, @mission, @region, @onStageChestNo, @offStageChestNo, @comments);
        SELECT ID AS id, CONVERT(varchar(23), CreatedAt, 126) + 'Z' AS createdAt FROM @saved;`);
    const { id, createdAt } = result.recordset[0];
    return res.status(201).json({ message: `Contestant saved. ID: ${id}.`, id, createdAt });
  } catch (error) {
    if (error.number === 51062) {
      return res.status(409).json({ message: error.message });
    }
    if ([2601, 2627, 51002].includes(error.number)) {
      return res.status(409).json({ message: 'A contestant with the same first name, last name, age group, and mission already exists. Check the existing record before adding another contestant.' });
    }
    console.error('Create-contestant database error:', error);
    return res.status(500).json({ message: 'Database error.' });
  }
});

const eventColumns = 'EventID, EventName, EventAgeGroup, RTRIM(IndividualGroup) AS IndividualGroup, RTRIM(OnStageOffStage) AS OnStageOffStage, Comments';

app.get('/api/events', authMiddleware, async (req, res) => {
  try {
    await dbReady;
    const result = await db.request().query(`SELECT ${eventColumns} FROM dbo.Events ORDER BY EventName, ${ageCategoryOrder('EventAgeGroup')}, EventAgeGroup, EventID;`);
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
    const result = await db.request().input('id', sql.NVarChar(50), id)
      .query(`SELECT ${eventColumns} FROM dbo.Events WHERE EventID=@id;`);
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
    const request = db.request().input('id', sql.NVarChar(50), id);
    for (const field of Object.keys(limits)) {
      const type = field === 'EventAgeGroup' ? sql.NVarChar(50) : sql.VarChar(limits[field]);
      request.input(field, type, data[field] || null);
      request.input(`original${field}`, type, String(original[field] || '').trim() || null);
    }
    await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION;
      BEGIN TRY
        IF EXISTS (SELECT 1 FROM dbo.EventRegistrations WITH (UPDLOCK, HOLDLOCK) WHERE EventID=@id)
          AND (@EventName<>@originalEventName OR @EventAgeGroup<>@originalEventAgeGroup
            OR @IndividualGroup<>@originalIndividualGroup OR @OnStageOffStage<>@originalOnStageOffStage)
          THROW 51061, 'This event has registrations. Only comments can be changed.', 1;
        UPDATE dbo.Events SET EventName=@EventName, EventAgeGroup=@EventAgeGroup,
          IndividualGroup=@IndividualGroup, OnStageOffStage=@OnStageOffStage, Comments=@Comments
        WHERE EventID=@id AND EventName=@originalEventName AND EventAgeGroup=@originalEventAgeGroup
          AND IndividualGroup=@originalIndividualGroup AND OnStageOffStage=@originalOnStageOffStage
          AND ISNULL(Comments,'')=ISNULL(@originalComments,'');
        IF @@ROWCOUNT<>1 THROW 51060, 'Event details changed or the ID is missing. Reload before saving.', 1;
        COMMIT TRANSACTION;
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
        THROW;
      END CATCH;`);
    return res.json({ message: 'Event details updated.' });
  } catch (error) {
    if ([51060, 51061].includes(error.number)) return res.status(409).json({ message: error.message });
    if ([2601, 2627, 51003].includes(error.number))
      return res.status(409).json({ message: 'An event with these details already exists.' });
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
    const result = await db.request()
      .input('EventName', sql.VarChar(50), data.EventName)
      .input('EventAgeGroup', sql.NVarChar(50), data.EventAgeGroup)
      .input('IndividualGroup', sql.Char(10), data.IndividualGroup)
      .input('OnStageOffStage', sql.Char(10), data.OnStageOffStage)
      .input('Comments', sql.VarChar(50), data.Comments || null)
      .query(`DECLARE @saved TABLE (EventID nvarchar(50));
        INSERT INTO dbo.Events
        ([EventName], [EventAgeGroup], [IndividualGroup], [OnStageOffStage], [Comments])
        OUTPUT INSERTED.EventID INTO @saved (EventID)
        VALUES (@EventName, @EventAgeGroup, @IndividualGroup, @OnStageOffStage, @Comments);
        SELECT EventID FROM @saved;`);
    const eventId = result.recordset[0].EventID;
    return res.status(201).json({ message: `Event saved. ID: ${eventId}.`, EventID: eventId });
  } catch (error) {
    if ([2601, 2627, 51003].includes(error.number)) {
      return res.status(409).json({ message: 'An event with the same name, age group, individual/group type, and stage already exists.' });
    }
    console.error('Create-event database error:', error);
    return res.status(500).json({ message: 'Unable to save the event.' });
  }
});

app.get('/api/event-registration-options', authMiddleware, async (req, res) => {
  try {
    await dbReady;
    const result = await db.request().query(`
      SELECT EventID, EventName, EventAgeGroup, IndividualGroup, OnStageOffStage
      FROM dbo.Events ORDER BY EventName, ${ageCategoryOrder('EventAgeGroup')}, EventAgeGroup, EventID;
      SELECT ID AS ContestantID, [First Name] AS ContestantFirstName,
        [Last Name] AS ContestantLastName, Mission AS ContestantMission,
        OnStageChestNo, OffStageChestNo, AgeGroup
      FROM dbo.Contestants ORDER BY [First Name], [Last Name], ID;
    `);
    return res.json({ events: result.recordsets[0], contestants: result.recordsets[1] });
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
    // Copy the current source rows in one statement. Never trust posted display fields.
    const result = await db.request()
      .input('EventID', sql.NVarChar(50), data.EventID)
      .input('ContestantID', sql.NVarChar(50), data.ContestantID)
      .input('Comments', sql.VarChar(50), data.Comments || null)
      .query(`
        INSERT INTO dbo.EventRegistrations
          (EventID, EventName, EventAgeGroup, IndividualGroup, OnStageOffStage,
           ContestantID, ContestantFirstName, ContestantLastName, ContestantMission, ChestNo, Comments)
        SELECT e.EventID, e.EventName, e.EventAgeGroup, e.IndividualGroup, e.OnStageOffStage,
          c.ID, c.[First Name], c.[Last Name], c.Mission, chest.ChestNo, @Comments
        FROM dbo.Events e CROSS JOIN dbo.Contestants c
        CROSS APPLY (SELECT CASE LOWER(REPLACE(REPLACE(LTRIM(RTRIM(e.OnStageOffStage)), ' ', ''), '-', ''))
          WHEN 'onstage' THEN c.OnStageChestNo WHEN 'offstage' THEN c.OffStageChestNo END AS ChestNo) chest
        WHERE e.EventID = @EventID AND c.ID = @ContestantID
          AND (SELECT COUNT(*) FROM dbo.Events WHERE EventID = @EventID) = 1
          AND (SELECT COUNT(*) FROM dbo.Contestants WHERE ID = @ContestantID) = 1
          AND (LOWER(LTRIM(RTRIM(e.IndividualGroup))) <> 'individual'
            OR (NULLIF(LTRIM(RTRIM(e.EventAgeGroup)), '') IS NOT NULL
              AND LOWER(LTRIM(RTRIM(e.EventAgeGroup))) = LOWER(LTRIM(RTRIM(c.AgeGroup)))))
          AND NULLIF(LTRIM(RTRIM(chest.ChestNo)), '') IS NOT NULL;
      `);
    if (result.rowsAffected[0] !== 1) {
      return res.status(400).json({ message: 'Select an existing event and contestant with unique IDs, a valid event stage, and a chest number for that stage. Individual events require the contestant and event to have the same age group. Reload the page if their details have changed.' });
    }
    return res.status(201).json({ message: 'Event registration saved.' });
  } catch (error) {
    if (error.number === 51004) {
      return res.status(409).json({ message: 'This contestant already has 3 individual item registrations. On-stage and off-stage items count toward the same limit.' });
    }
    if ([2601, 2627, 51001].includes(error.number)) {
      return res.status(409).json({ message: 'This contestant is already registered for this event.' });
    }
    console.error('Create-event-registration database error:', error);
    return res.status(500).json({ message: 'Unable to save the event registration.' });
  }
});

require('./group-contestant-routes')(app, { db, dbReady, sql, authMiddleware });
require('./event-registration-edit-routes')(app, { db, dbReady, sql, authMiddleware });
require('./results-routes')(app, { db, dbReady, sql, authMiddleware, isAdmin });
require('./certificate-routes')(app, { db, dbReady, sql, authMiddleware });

app.post('/logout', (req, res) => {
  const { accountKey, loginToken } = req.session;
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ message: 'Error logging out.' });
    activeSessions.release(accountKey, loginToken);
    res.clearCookie('connect.sid');
    return res.json({ message: 'Logged out successfully.' });
  });
});

dbReady.then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}).catch((error) => {
  console.error('Unable to connect to SQL Server:', error);
  process.exit(1);
});
