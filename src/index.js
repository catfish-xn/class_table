// 课表工具 · Cloudflare Worker 入口
// /api/* 由这里处理，其余请求交给静态资源（public/）。
import { SCHEMA_SQL, SCHEMA_VERSION, splitStatements } from './schema.js';

/* ---------------- 基础工具 ---------------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = '找不到这条记录') => new HttpError(404, msg);
const conflict = (msg) => new HttpError(409, msg);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const END_RE = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const COLOR_RE = /^[a-z]{2,16}$/;
/** 学员初始课费的生效日期：早于任何课程，保证总能查到课费 */
const BASE_FEE_DATE = '1900-01-01';

function reqDate(v, label = '日期') {
  if (typeof v !== 'string' || !DATE_RE.test(v)) throw bad(`${label}格式不正确`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad(`${label}不存在`);
  return v;
}

function reqTimeRange(start, end) {
  if (typeof start !== 'string' || !TIME_RE.test(start)) throw bad('开始时间格式不正确');
  if (typeof end !== 'string' || !END_RE.test(end)) throw bad('结束时间格式不正确');
  if (start >= end) throw bad('结束时间需要晚于开始时间');
  return [start, end];
}

function reqName(v, label = '名称', max = 40) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw bad(`请填写${label}`);
  if (s.length > max) throw bad(`${label}太长了（最多 ${max} 个字）`);
  return s;
}

function reqFee(v) {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (v === '' || v == null || typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1_000_000) {
    throw bad('课费需要是不小于 0 的数字');
  }
  return Math.round(n * 100) / 100;
}

function reqId(v, label = 'ID') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`${label}不正确`);
  return n;
}

function optId(v, label) {
  return v == null || v === '' ? null : reqId(v, label);
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const overlaps = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;

const bool = (v) => (v ? 1 : 0);

/* ---------------- 数据库 ---------------- */

let schemaReady = null;

/** 首次请求时确保表结构存在（幂等），失败会在下次请求重试。 */
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      try {
        const row = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
        if (row && Number(row.value) >= SCHEMA_VERSION) return;
      } catch {
        // meta 表还不存在：全新数据库
      }
      await db.batch(splitStatements(SCHEMA_SQL).map((s) => db.prepare(s)));
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const LESSON_COLS = `id, date, start_time AS start, end_time AS "end", student_id, fee, status,
  content, handout_sent, needs_resend`;

function mapLesson(r) {
  return {
    id: r.id,
    date: r.date,
    start: r.start,
    end: r.end,
    student_id: r.student_id,
    fee: r.fee,
    status: r.status,
    content: r.content ?? '',
    handout_sent: !!r.handout_sent,
    needs_resend: !!r.needs_resend,
  };
}

/** 按课程日期查学员当时的课费（课费记录里生效日期 ≤ 课程日期的最近一条） */
const FEE_AT = (studentExpr, dateExpr) => `(SELECT sf.fee FROM student_fees sf
  WHERE sf.student_id = ${studentExpr} AND sf.effective_date <= ${dateExpr}
  ORDER BY sf.effective_date DESC LIMIT 1)`;

function insertLessonStmt(db, date, start, end, studentId) {
  return db
    .prepare(
      `INSERT INTO lessons (date, start_time, end_time, student_id, fee)
       SELECT ?1, ?2, ?3, s.id, COALESCE(${FEE_AT('s.id', '?1')}, s.fee)
       FROM students s WHERE s.id = ?4
       RETURNING ${LESSON_COLS}`,
    )
    .bind(date, start, end, studentId);
}

/** 生效日期及之后的课按课费记录重算；返回实际改变的节数 */
function recomputeFeesStmt(db, studentId, fromDate) {
  return db
    .prepare(
      `UPDATE lessons
         SET fee = COALESCE(${FEE_AT('lessons.student_id', 'lessons.date')}, fee),
             updated_at = datetime('now')
       WHERE student_id = ?1 AND date >= ?2
         AND fee IS NOT COALESCE(${FEE_AT('lessons.student_id', 'lessons.date')}, fee)`,
    )
    .bind(studentId, fromDate);
}

/** students.fee 保存最新一次设定的课费 */
function syncStudentFeeStmt(db, studentId) {
  return db
    .prepare(
      `UPDATE students SET fee = COALESCE((SELECT fee FROM student_fees
         WHERE student_id = ?1 ORDER BY effective_date DESC LIMIT 1), fee)
       WHERE id = ?1`,
    )
    .bind(studentId);
}

async function loadBase(db) {
  const [orgs, prices, grades, slots, students, fees, counts] = await db.batch([
    db.prepare('SELECT id, name, color, sort FROM orgs ORDER BY sort, id'),
    db.prepare('SELECT org_id, grade_id, fee FROM org_grade_prices'),
    db.prepare('SELECT id, name, sort FROM grades ORDER BY sort, id'),
    db.prepare('SELECT id, start_time AS start, end_time AS "end" FROM slots ORDER BY start_time, end_time, id'),
    db.prepare('SELECT id, name, type, org_id, grade_id, fee, active, created_at FROM students ORDER BY name, id'),
    db.prepare('SELECT id, student_id, effective_date, fee FROM student_fees ORDER BY student_id, effective_date'),
    db.prepare(`SELECT student_id,
        SUM(CASE WHEN status = 'normal' THEN 1 ELSE 0 END) AS lessons,
        SUM(needs_resend) AS resend
      FROM lessons GROUP BY student_id`),
  ]);

  const priceMap = new Map();
  for (const p of prices.results) {
    if (!priceMap.has(p.org_id)) priceMap.set(p.org_id, {});
    priceMap.get(p.org_id)[p.grade_id] = p.fee;
  }
  const feeMap = new Map();
  for (const f of fees.results) {
    if (!feeMap.has(f.student_id)) feeMap.set(f.student_id, []);
    feeMap.get(f.student_id).push({ id: f.id, effective_date: f.effective_date, fee: f.fee });
  }
  const countMap = new Map(counts.results.map((c) => [c.student_id, c]));

  return {
    orgs: orgs.results.map((o) => ({ ...o, prices: priceMap.get(o.id) || {} })),
    grades: grades.results,
    slots: slots.results,
    students: students.results.map((s) => ({
      ...s,
      active: !!s.active,
      fees: feeMap.get(s.id) || [{ id: 0, effective_date: BASE_FEE_DATE, fee: s.fee }],
      lesson_count: countMap.get(s.id)?.lessons || 0,
      resend_count: countMap.get(s.id)?.resend || 0,
    })),
  };
}

async function listLessons(db, from, to) {
  const { results } = await db
    .prepare(`SELECT ${LESSON_COLS} FROM lessons WHERE date BETWEEN ? AND ? ORDER BY date, start_time, id`)
    .bind(from, to)
    .all();
  return results.map(mapLesson);
}

/** 补发提醒：有"需要补发"记录、且下一节课在两天之内的学员 */
async function loadReminders(db, today, now) {
  const until = addDays(today, 2);
  const [pending, upcoming] = await db.batch([
    db.prepare(`SELECT l.student_id, s.name, COUNT(*) AS count
      FROM lessons l JOIN students s ON s.id = l.student_id
      WHERE l.needs_resend = 1 GROUP BY l.student_id, s.name`),
    db
      .prepare(`SELECT id, student_id, date, start_time AS start, end_time AS "end"
        FROM lessons
        WHERE status = 'normal' AND date BETWEEN ?1 AND ?2 AND (date > ?1 OR end_time > ?3)
        ORDER BY date, start_time`)
      .bind(today, until, now),
  ]);
  const next = new Map();
  for (const l of upcoming.results) if (!next.has(l.student_id)) next.set(l.student_id, l);
  return pending.results
    .filter((p) => next.has(p.student_id))
    .map((p) => ({ student_id: p.student_id, name: p.name, count: p.count, next: next.get(p.student_id) }))
    .sort((a, b) => (a.next.date + a.next.start).localeCompare(b.next.date + b.next.start));
}

/* ---------------- 路由 ---------------- */

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    `^${pattern.replace(/:(\w+)/g, (_, k) => {
      keys.push(k);
      return '(\\d+)';
    })}$`,
  );
  routes.push({ method, re, keys, handler });
}

route('GET', '/api/health', async () => ({ ok: true }));

route('GET', '/api/bootstrap', async ({ db, query }) => {
  const out = await loadBase(db);
  if (query.week) {
    const start = reqDate(query.week, '周开始日期');
    out.week = { start, lessons: await listLessons(db, start, addDays(start, 6)) };
  }
  if (query.today) {
    const now = TIME_RE.test(query.now || '') ? query.now : '00:00';
    out.reminders = await loadReminders(db, reqDate(query.today), now);
  }
  return out;
});

/* ---- 机构 ---- */

function readPrices(prices) {
  if (prices == null) return null;
  if (typeof prices !== 'object') throw bad('价目表格式不正确');
  const out = [];
  for (const [gradeId, fee] of Object.entries(prices)) {
    if (fee === '' || fee == null) continue;
    out.push([reqId(gradeId, '年级'), reqFee(fee)]);
  }
  return out;
}

const insertPriceStmt = (db, orgId, gradeId, fee) =>
  db
    .prepare(
      `INSERT INTO org_grade_prices (org_id, grade_id, fee)
       SELECT ?1, id, ?3 FROM grades WHERE id = ?2
       ON CONFLICT (org_id, grade_id) DO UPDATE SET fee = excluded.fee`,
    )
    .bind(orgId, gradeId, fee);

route('POST', '/api/orgs', async ({ db, body }) => {
  const name = reqName(body.name, '机构名称');
  const color = COLOR_RE.test(body.color || '') ? body.color : 'blue';
  const prices = readPrices(body.prices) || [];
  const org = await db
    .prepare(
      `INSERT INTO orgs (name, color, sort)
       VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM orgs)) RETURNING id`,
    )
    .bind(name, color)
    .first();
  if (prices.length) await db.batch(prices.map(([g, f]) => insertPriceStmt(db, org.id, g, f)));
  return { id: org.id };
});

route('PUT', '/api/orgs/:id', async ({ db, params, body }) => {
  const id = params.id;
  const org = await db.prepare('SELECT id FROM orgs WHERE id = ?').bind(id).first();
  if (!org) throw notFound('机构不存在');
  const name = reqName(body.name, '机构名称');
  const color = COLOR_RE.test(body.color || '') ? body.color : 'blue';
  const prices = readPrices(body.prices);
  const stmts = [db.prepare('UPDATE orgs SET name = ?, color = ? WHERE id = ?').bind(name, color, id)];
  if (prices) {
    stmts.push(db.prepare('DELETE FROM org_grade_prices WHERE org_id = ?').bind(id));
    for (const [g, f] of prices) stmts.push(insertPriceStmt(db, id, g, f));
  }
  await db.batch(stmts);
  return { id };
});

route('DELETE', '/api/orgs/:id', async ({ db, params }) => {
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM students WHERE org_id = ?').bind(params.id).first();
  if (n > 0) throw conflict(`这个机构下还有 ${n} 个学员/班课，请先删除或改到其他机构`);
  await db.batch([
    db.prepare('DELETE FROM org_grade_prices WHERE org_id = ?').bind(params.id),
    db.prepare('DELETE FROM orgs WHERE id = ?').bind(params.id),
  ]);
  return { ok: true };
});

/* ---- 年级 ---- */

route('POST', '/api/grades', async ({ db, body }) => {
  const name = reqName(body.name, '年级名称', 20);
  const row = await db
    .prepare('INSERT INTO grades (name, sort) VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM grades)) RETURNING id')
    .bind(name)
    .first();
  return { id: row.id };
});

route('PUT', '/api/grades/:id', async ({ db, params, body }) => {
  const name = reqName(body.name, '年级名称', 20);
  const r = await db.prepare('UPDATE grades SET name = ? WHERE id = ?').bind(name, params.id).run();
  if (!r.meta.changes) throw notFound('年级不存在');
  return { id: params.id };
});

route('DELETE', '/api/grades/:id', async ({ db, params }) => {
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM students WHERE grade_id = ?').bind(params.id).first();
  if (n > 0) throw conflict(`还有 ${n} 个学员/班课是这个年级，不能删除`);
  await db.batch([
    db.prepare('DELETE FROM org_grade_prices WHERE grade_id = ?').bind(params.id),
    db.prepare('DELETE FROM grades WHERE id = ?').bind(params.id),
  ]);
  return { ok: true };
});

route('POST', '/api/grades/order', async ({ db, body }) => {
  if (!Array.isArray(body.ids) || !body.ids.length) throw bad('排序数据不正确');
  const ids = body.ids.map((v) => reqId(v, '年级'));
  await db.batch(ids.map((id, i) => db.prepare('UPDATE grades SET sort = ? WHERE id = ?').bind(i + 1, id)));
  return { ok: true };
});

/* ---- 时间段模板 ---- */

route('POST', '/api/slots', async ({ db, body }) => {
  const [start, end] = reqTimeRange(body.start, body.end);
  const row = await db
    .prepare('INSERT INTO slots (start_time, end_time) VALUES (?, ?) RETURNING id')
    .bind(start, end)
    .first();
  return { id: row.id };
});

route('PUT', '/api/slots/:id', async ({ db, params, body }) => {
  const [start, end] = reqTimeRange(body.start, body.end);
  const r = await db
    .prepare('UPDATE slots SET start_time = ?, end_time = ? WHERE id = ?')
    .bind(start, end, params.id)
    .run();
  if (!r.meta.changes) throw notFound('时间段不存在');
  return { id: params.id };
});

route('DELETE', '/api/slots/:id', async ({ db, params }) => {
  await db.prepare('DELETE FROM slots WHERE id = ?').bind(params.id).run();
  return { ok: true };
});

/* ---- 学员 / 班课 ---- */

const STUDENT_TYPES = ['one', 'class'];

async function checkOrgGrade(db, orgId, gradeId) {
  const org = await db.prepare('SELECT id FROM orgs WHERE id = ?').bind(orgId).first();
  if (!org) throw bad('请选择机构');
  if (gradeId != null) {
    const g = await db.prepare('SELECT id FROM grades WHERE id = ?').bind(gradeId).first();
    if (!g) throw bad('年级不存在');
  }
}

route('POST', '/api/students', async ({ db, body }) => {
  const name = reqName(body.name, '名称');
  const type = STUDENT_TYPES.includes(body.type) ? body.type : 'one';
  const orgId = reqId(body.org_id, '机构');
  const gradeId = optId(body.grade_id, '年级');
  const fee = reqFee(body.fee);
  const active = body.active === undefined ? 1 : bool(body.active);
  await checkOrgGrade(db, orgId, gradeId);

  const row = await db
    .prepare(
      'INSERT INTO students (name, type, org_id, grade_id, fee, active) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    )
    .bind(name, type, orgId, gradeId, fee, active)
    .first();
  const stmts = [
    db
      .prepare('INSERT INTO student_fees (student_id, effective_date, fee) VALUES (?, ?, ?)')
      .bind(row.id, BASE_FEE_DATE, fee),
  ];
  if (body.save_price && gradeId != null) stmts.push(insertPriceStmt(db, orgId, gradeId, fee));
  await db.batch(stmts);
  return { id: row.id };
});

route('PUT', '/api/students/:id', async ({ db, params, body }) => {
  const cur = await db.prepare('SELECT * FROM students WHERE id = ?').bind(params.id).first();
  if (!cur) throw notFound('学员不存在');
  const name = body.name === undefined ? cur.name : reqName(body.name, '名称');
  const type = STUDENT_TYPES.includes(body.type) ? body.type : cur.type;
  const orgId = body.org_id === undefined ? cur.org_id : reqId(body.org_id, '机构');
  const gradeId = body.grade_id === undefined ? cur.grade_id : optId(body.grade_id, '年级');
  const active = body.active === undefined ? cur.active : bool(body.active);
  await checkOrgGrade(db, orgId, gradeId);
  await db
    .prepare('UPDATE students SET name = ?, type = ?, org_id = ?, grade_id = ?, active = ? WHERE id = ?')
    .bind(name, type, orgId, gradeId, active, params.id)
    .run();
  return { id: params.id };
});

route('DELETE', '/api/students/:id', async ({ db, params }) => {
  await db.batch([
    db.prepare('DELETE FROM lessons WHERE student_id = ?').bind(params.id),
    db.prepare('DELETE FROM student_fees WHERE student_id = ?').bind(params.id),
    db.prepare('DELETE FROM students WHERE id = ?').bind(params.id),
  ]);
  return { ok: true };
});

/** 改课费：记录新课费，生效日期及之后的课按新课费重算 */
async function changeFee(db, studentId, fee, effectiveDate) {
  const [, , recomputed] = await db.batch([
    db
      .prepare(
        `INSERT INTO student_fees (student_id, effective_date, fee) VALUES (?, ?, ?)
         ON CONFLICT (student_id, effective_date) DO UPDATE SET fee = excluded.fee`,
      )
      .bind(studentId, effectiveDate, fee),
    syncStudentFeeStmt(db, studentId),
    recomputeFeesStmt(db, studentId, effectiveDate),
  ]);
  return recomputed.meta.changes || 0;
}

route('POST', '/api/students/:id/fee', async ({ db, params, body }) => {
  const s = await db.prepare('SELECT id FROM students WHERE id = ?').bind(params.id).first();
  if (!s) throw notFound('学员不存在');
  const fee = reqFee(body.fee);
  const date = reqDate(body.effective_date, '生效日期');
  const updated = await changeFee(db, params.id, fee, date);
  return { updated };
});

route('DELETE', '/api/students/:id/fee/:feeId', async ({ db, params }) => {
  const row = await db
    .prepare('SELECT effective_date FROM student_fees WHERE id = ? AND student_id = ?')
    .bind(params.feeId, params.id)
    .first();
  if (!row) throw notFound('课费记录不存在');
  if (row.effective_date === BASE_FEE_DATE) throw bad('初始课费不能删除');
  const [, , recomputed] = await db.batch([
    db.prepare('DELETE FROM student_fees WHERE id = ?').bind(params.feeId),
    syncStudentFeeStmt(db, params.id),
    recomputeFeesStmt(db, params.id, row.effective_date),
  ]);
  return { updated: recomputed.meta.changes || 0 };
});

/** 升学：年级 +1，课费默认不变；可选同时改课费 */
route('POST', '/api/students/:id/promote', async ({ db, params, body }) => {
  const s = await db.prepare('SELECT id, grade_id FROM students WHERE id = ?').bind(params.id).first();
  if (!s) throw notFound('学员不存在');
  const { results: grades } = await db.prepare('SELECT id FROM grades ORDER BY sort, id').all();
  const idx = grades.findIndex((g) => g.id === s.grade_id);
  const next = idx >= 0 ? grades[idx + 1] : null;
  if (!next) throw bad(idx >= 0 ? '已经是最高年级了' : '这个学员还没有设置年级');
  await db.prepare('UPDATE students SET grade_id = ? WHERE id = ?').bind(next.id, params.id).run();
  let updated = 0;
  if (body.fee != null && body.fee !== '') {
    updated = await changeFee(db, params.id, reqFee(body.fee), reqDate(body.effective_date, '生效日期'));
  }
  return { grade_id: next.id, updated };
});

route('GET', '/api/students/:id/lessons', async ({ db, params }) => {
  const { results } = await db
    .prepare(`SELECT ${LESSON_COLS} FROM lessons WHERE student_id = ? ORDER BY date DESC, start_time DESC, id DESC`)
    .bind(params.id)
    .all();
  return { lessons: results.map(mapLesson) };
});

/** 已补发：清除该学员所有"需要补发"标记 */
route('POST', '/api/students/:id/resent', async ({ db, params }) => {
  const r = await db
    .prepare("UPDATE lessons SET needs_resend = 0, updated_at = datetime('now') WHERE student_id = ? AND needs_resend = 1")
    .bind(params.id)
    .run();
  return { updated: r.meta.changes || 0 };
});

/* ---- 课程 ---- */

route('GET', '/api/lessons', async ({ db, query }) => {
  const from = reqDate(query.from, '开始日期');
  const to = reqDate(query.to, '结束日期');
  if (daysBetween(from, to) > 62) throw bad('一次最多查询两个月');
  return { lessons: await listLessons(db, from, to) };
});

route('POST', '/api/lessons', async ({ db, body }) => {
  const date = reqDate(body.date);
  const [start, end] = reqTimeRange(body.start, body.end);
  const studentId = reqId(body.student_id, '学员');
  const row = await insertLessonStmt(db, date, start, end, studentId).first();
  if (!row) throw bad('学员不存在');
  return { lesson: mapLesson(row) };
});

route('PATCH', '/api/lessons/:id', async ({ db, params, body }) => {
  const sets = [];
  const args = [];
  const set = (sql, v) => {
    sets.push(sql);
    args.push(v);
  };
  if (body.start !== undefined || body.end !== undefined) {
    const [start, end] = reqTimeRange(body.start, body.end);
    set('start_time = ?', start);
    set('end_time = ?', end);
  }
  if (body.date !== undefined) {
    const date = reqDate(body.date);
    set('date = ?', date);
    // 换日期后按新日期重新取课费
    set(`fee = COALESCE(${FEE_AT('lessons.student_id', '?')}, fee)`, date);
  }
  if (body.status !== undefined) {
    if (!['normal', 'cancelled'].includes(body.status)) throw bad('状态不正确');
    set('status = ?', body.status);
  }
  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || body.content.length > 5000) throw bad('上课内容太长了');
    set('content = ?', body.content);
  }
  if (body.handout_sent !== undefined) set('handout_sent = ?', bool(body.handout_sent));
  if (body.needs_resend !== undefined) set('needs_resend = ?', bool(body.needs_resend));
  if (!sets.length) throw bad('没有要修改的内容');

  const row = await db
    .prepare(
      `UPDATE lessons SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE id = ? RETURNING ${LESSON_COLS}`,
    )
    .bind(...args, params.id)
    .first();
  if (!row) throw notFound('这节课不存在（可能已被删除）');
  return { lesson: mapLesson(row) };
});

route('DELETE', '/api/lessons/:id', async ({ db, params }) => {
  await db.prepare('DELETE FROM lessons WHERE id = ?').bind(params.id).run();
  return { ok: true };
});

/** 该学员在这节课之前、最近一次填写过内容的课 */
route('GET', '/api/lessons/:id/previous', async ({ db, params }) => {
  const cur = await db
    .prepare('SELECT id, student_id, date, start_time FROM lessons WHERE id = ?')
    .bind(params.id)
    .first();
  if (!cur) throw notFound('这节课不存在（可能已被删除）');
  const row = await db
    .prepare(
      `SELECT ${LESSON_COLS} FROM lessons
       WHERE student_id = ?1 AND id != ?2 AND status = 'normal' AND content != ''
         AND (date < ?3 OR (date = ?3 AND start_time < ?4))
       ORDER BY date DESC, start_time DESC LIMIT 1`,
    )
    .bind(cur.student_id, cur.id, cur.date, cur.start_time)
    .first();
  return { previous: row ? mapLesson(row) : null };
});

/** 套用往周：只复制正常课程的学员和时间 */
route('POST', '/api/lessons/copy-week', async ({ db, body }) => {
  const from = reqDate(body.from, '来源周');
  const to = reqDate(body.to, '目标周');
  if (from === to) throw bad('来源周和目标周是同一周');
  const mode = body.mode === 'overwrite' ? 'overwrite' : 'fill';
  const offset = daysBetween(from, to);
  const toEnd = addDays(to, 6);

  const [src, dst] = await db.batch([
    db
      .prepare(`SELECT l.date, l.start_time, l.end_time, l.student_id, s.active
        FROM lessons l JOIN students s ON s.id = l.student_id
        WHERE l.date BETWEEN ? AND ? AND l.status = 'normal'
        ORDER BY l.date, l.start_time`)
      .bind(from, addDays(from, 6)),
    db.prepare('SELECT id, date, start_time, end_time FROM lessons WHERE date BETWEEN ? AND ?').bind(to, toEnd),
  ]);

  const stmts = [];
  let deleted = 0;
  const existing = mode === 'fill' ? dst.results : [];
  if (mode === 'overwrite' && dst.results.length) {
    stmts.push(db.prepare('DELETE FROM lessons WHERE date BETWEEN ? AND ?').bind(to, toEnd));
    deleted = dst.results.length;
  }
  let created = 0;
  let skippedConflict = 0;
  let skippedInactive = 0;
  for (const l of src.results) {
    if (!l.active) {
      skippedInactive++;
      continue;
    }
    const date = addDays(l.date, offset);
    const clash = existing.some((e) => e.date === date && overlaps(e.start_time, e.end_time, l.start_time, l.end_time));
    if (clash) {
      skippedConflict++;
      continue;
    }
    stmts.push(insertLessonStmt(db, date, l.start_time, l.end_time, l.student_id));
    created++;
  }
  if (stmts.length) await db.batch(stmts);
  return { created, deleted, skipped_conflict: skippedConflict, skipped_inactive: skippedInactive };
});

/* ---- 提醒 & 统计 ---- */

route('GET', '/api/reminders', async ({ db, query }) => {
  const now = TIME_RE.test(query.now || '') ? query.now : '00:00';
  return { reminders: await loadReminders(db, reqDate(query.today), now) };
});

route('GET', '/api/stats', async ({ db, query }) => {
  const month = String(query.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('月份格式不正确');
  const [y, m] = month.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${month}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const prevFrom = m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
  const [rows, prev] = await db.batch([
    db
      .prepare(`SELECT l.id, l.date, l.start_time AS start, l.end_time AS "end", l.student_id, l.fee, l.status
        FROM lessons l WHERE l.date >= ? AND l.date < ? ORDER BY l.date, l.start_time`)
      .bind(from, to),
    db
      .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(fee), 0) AS total
        FROM lessons WHERE status = 'normal' AND date >= ? AND date < ?`)
      .bind(prevFrom, from),
  ]);
  return { month, lessons: rows.results, prev: prev.results[0] };
});

/* ---------------- 入口 ---------------- */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

async function handleApi(request, env, url) {
  const method = request.method.toUpperCase();
  let matchedPath = false;
  for (const r of routes) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    matchedPath = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => {
      params[k] = Number(m[i + 1]);
    });
    let body = {};
    if (method !== 'GET' && method !== 'DELETE') {
      try {
        body = (await request.json()) ?? {};
      } catch {
        body = {};
      }
      if (typeof body !== 'object' || Array.isArray(body)) body = {};
    }
    if (!env.DB) throw new HttpError(500, '没有找到 D1 数据库绑定（DB），请检查 wrangler 配置');
    await ensureSchema(env.DB);
    const query = Object.fromEntries(url.searchParams);
    return json(await r.handler({ db: env.DB, params, query, body }));
  }
  throw new HttpError(matchedPath ? 405 : 404, matchedPath ? '不支持的请求方式' : '接口不存在');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: '服务器出错了，请稍后再试' }, 500);
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
