const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const initSqlJs = require("sql.js");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-this";
const DB_FILE = path.join(__dirname, "finflow.sqlite");
let db;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Token ausente." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Token invalido." });
  }
}

function persistDb() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function run(sql, params = []) {
  db.run(sql, params);
  persistDb();
}

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 6) {
    return res.status(400).json({ error: "Dados invalidos para cadastro." });
  }
  const exists = getOne("SELECT id FROM users WHERE email = ?", [email]);
  if (exists) return res.status(409).json({ error: "Email ja cadastrado." });
  const passwordHash = bcrypt.hashSync(password, 10);
  run("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)", [
    name,
    email,
    passwordHash
  ]);
  return res.json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = getOne(
    "SELECT id, name, email, password_hash FROM users WHERE email = ?",
    [email]
  );
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Email ou senha invalidos." });
  }
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "7d"
  });
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email }
  });
});

app.get("/api/state", authMiddleware, (req, res) => {
  const row = getOne("SELECT data_json FROM user_states WHERE user_id = ?", [
    req.user.id
  ]);
  if (!row) return res.json({ data: null });
  try {
    return res.json({ data: JSON.parse(row.data_json) });
  } catch {
    return res.json({ data: null });
  }
});

app.put("/api/state", authMiddleware, (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Payload invalido." });
  }
  const json = JSON.stringify(data);
  run(`
    INSERT INTO user_states (user_id, data_json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      data_json = excluded.data_json,
      updated_at = CURRENT_TIMESTAMP
  `, [req.user.id, json]);
  return res.json({ ok: true });
});

async function start() {
  const SQL = await initSqlJs();
  const fileBuffer = fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE) : null;
  db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  db.run("PRAGMA foreign_keys = ON;");
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS user_states (
      user_id INTEGER PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  persistDb();

  app.listen(PORT, () => {
    console.log(`Finanças Pessoais API on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Falha ao iniciar API:", err);
  process.exit(1);
});
