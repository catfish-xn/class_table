// 数据库结构。migrations/0001_init.sql 与这里保持一致（test/schema.test.mjs 会校验）。
// Worker 首次处理请求时也会执行这些语句（全部幂等），
// 所以即使部署平台没有运行 D1 migrations，应用也能自动建表。

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orgs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT 'blue',
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grades (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS org_grade_prices (
  org_id   INTEGER NOT NULL,
  grade_id INTEGER NOT NULL,
  fee      REAL NOT NULL,
  PRIMARY KEY (org_id, grade_id)
);

CREATE TABLE IF NOT EXISTS students (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'one',
  org_id     INTEGER NOT NULL,
  grade_id   INTEGER,
  fee        REAL NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_fees (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id     INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  fee            REAL NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, effective_date)
);

CREATE TABLE IF NOT EXISTS slots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lessons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  student_id   INTEGER NOT NULL,
  fee          REAL NOT NULL,
  status       TEXT NOT NULL DEFAULT 'normal',
  content      TEXT NOT NULL DEFAULT '',
  handout_sent INTEGER NOT NULL DEFAULT 0,
  needs_resend INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lessons_date ON lessons (date, start_time);
CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons (student_id, date);
CREATE INDEX IF NOT EXISTS idx_student_fees_student ON student_fees (student_id, effective_date);

INSERT INTO grades (name, sort)
  SELECT column1, column2 FROM (VALUES
    ('初一', 1), ('初二', 2), ('初三', 3), ('高一', 4), ('高二', 5), ('高三', 6))
  WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = 'seeded');

INSERT INTO slots (start_time, end_time, sort)
  SELECT column1, column2, column3 FROM (VALUES
    ('08:00', '10:00', 1), ('10:00', '12:00', 2), ('14:00', '16:00', 3),
    ('16:00', '18:00', 4), ('18:00', '20:00', 5), ('20:00', '22:00', 6))
  WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = 'seeded');

INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded', '1');
INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1');
`;

/** 把 SQL 文本拆成单条语句（本文件里的语句不含字符串内的分号）。 */
export function splitStatements(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
