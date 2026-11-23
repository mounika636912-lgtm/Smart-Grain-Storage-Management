import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import express from "express";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(process.env.DB_PATH || path.join(rootDir, "data", "grainguard.sqlite"));
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("Set SESSION_SECRET to a random value of at least 32 characters.");
}

mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    session_data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
`);
database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

if (database.prepare("SELECT COUNT(*) AS count FROM admins").get().count === 0) {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error("Set ADMIN_USERNAME and ADMIN_PASSWORD to create the initial admin account.");
  }
  if (username.length > 64 || password.length < 12 || password.length > 128) {
    throw new Error("Use an admin username up to 64 characters and a password from 12 to 128 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  database.prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)").run(username, passwordHash);
}

const dummyPasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);

class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.getStatement = db.prepare("SELECT session_data FROM sessions WHERE sid = ? AND expires_at > ?");
    this.setStatement = db.prepare(`
      INSERT INTO sessions (sid, session_data, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET session_data = excluded.session_data, expires_at = excluded.expires_at
    `);
    this.destroyStatement = db.prepare("DELETE FROM sessions WHERE sid = ?");
    this.touchStatement = db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?");
  }

  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.session_data) : null);
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? Date.parse(sessionData.cookie.expires)
        : Date.now() + 8 * 60 * 60 * 1000;
      this.setStatement.run(sid, JSON.stringify(sessionData), expiresAt);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? Date.parse(sessionData.cookie.expires)
        : Date.now() + 8 * 60 * 60 * 1000;
      this.touchStatement.run(expiresAt, sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.destroyStatement.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

const app = express();
const sessionCookieName = "grainguard.sid";

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
}

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://upload.wikimedia.org", "https://thumb.wikimedia.org"],
      connectSrc: ["'self'", "https://commons.wikimedia.org"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
  strictTransportSecurity: isProduction ? undefined : false,
}));
app.use(express.json({ limit: "10kb" }));
app.use(session({
  name: sessionCookieName,
  secret: sessionSecret,
  store: new SqliteSessionStore(database),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  },
}));

function isValidCsrfToken(expected, received) {
  if (typeof expected !== "string" || typeof received !== "string") return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function requireCsrf(req, res, next) {
  if (!isValidCsrfToken(req.session.csrfToken, req.get("x-csrf-token"))) {
    return res.status(403).json({ error: "Your session has expired. Refresh the page and try again." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: "Authentication required." });
  }
  const admin = database.prepare("SELECT id, username FROM admins WHERE id = ?").get(req.session.adminId);
  if (!admin) {
    return req.session.destroy((error) => {
      if (error) return next(error);
      res.status(401).json({ error: "Authentication required." });
    });
  }
  req.admin = admin;
  next();
}

app.get("/api/auth/csrf", (req, res, next) => {
  req.session.csrfToken = randomBytes(32).toString("hex");
  req.session.save((error) => {
    if (error) return next(error);
    res.json({ csrfToken: req.session.csrfToken });
  });
});

app.post("/api/auth/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
}), requireCsrf, async (req, res, next) => {
  try {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!username || !password || username.length > 64 || password.length > 128) {
      return res.status(400).json({ error: "Enter a valid username and password." });
    }

    const admin = database.prepare("SELECT id, username, password_hash FROM admins WHERE username = ?").get(username);
    const passwordMatches = admin
      ? await bcrypt.compare(password, admin.password_hash)
      : await bcrypt.compare(password, dummyPasswordHash);

    if (!admin || !passwordMatches) {
      return res.status(401).json({ error: "The username or password is incorrect." });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.adminId = admin.id;
      req.session.csrfToken = randomBytes(32).toString("hex");
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.json({ username: admin.username, csrfToken: req.session.csrfToken });
      });
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAdmin, (req, res) => {
  res.json({ username: req.admin.username });
});

app.post("/api/auth/logout", requireAdmin, requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/" });
    res.status(204).end();
  });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

if (isProduction) {
  const distPath = path.join(rootDir, "dist");
  app.use(express.static(distPath, { index: false }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).json({ error: "An unexpected server error occurred." });
});

const server = app.listen(port, host, () => {
  console.log(`GrainGuard server listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  });
}
