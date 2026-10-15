// 接口测试：用 wrangler 的测试工具在本地 workerd 里运行 Worker（D1 为临时数据库）。
// 运行：npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from 'wrangler';

let server;

before(async () => {
  server = createTestHarness({ workers: [{ configPath: './wrangler.jsonc' }] });
  await server.listen();
});

after(async () => {
  await server?.close();
});

async function api(method, path, body) {
  const res = await server.fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function ok(method, path, body) {
  const r = await api(method, path, body);
  assert.equal(r.status, 200, `${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

const lessonsOf = async (from, to) => (await ok('GET', `/api/lessons?from=${from}&to=${to}`)).lessons;

let orgA;
let gradeIds;
let zhang; // 一对一，高一
let mathClass; // 班课，高三

test('首次请求自动建表并写入默认年级和时间段', async () => {
  const data = await ok('GET', '/api/bootstrap');
  assert.deepEqual(
    data.grades.map((g) => g.name),
    ['初一', '初二', '初三', '高一', '高二', '高三'],
  );
  assert.deepEqual(
    data.slots.map((s) => `${s.start}-${s.end}`),
    ['08:00-10:00', '10:00-12:00', '14:00-16:00', '16:00-18:00', '18:00-20:00', '20:00-22:00'],
  );
  gradeIds = Object.fromEntries(data.grades.map((g) => [g.name, g.id]));
});

test('机构：价目表只存填写的年级', async () => {
  const { id } = await ok('POST', '/api/orgs', {
    name: 'A 机构',
    color: 'teal',
    prices: { [gradeIds['高一']]: 150, [gradeIds['高二']]: '' },
  });
  orgA = id;
  const data = await ok('GET', '/api/bootstrap');
  const org = data.orgs.find((o) => o.id === orgA);
  assert.equal(org.color, 'teal');
  assert.deepEqual(org.prices, { [gradeIds['高一']]: 150 });
});

test('学员：课费必填；勾选"存入价目表"会补充机构价目', async () => {
  const missing = await api('POST', '/api/students', { name: '无课费', org_id: orgA, grade_id: gradeIds['高一'] });
  assert.equal(missing.status, 400);

  zhang = (await ok('POST', '/api/students', { name: '张三', type: 'one', org_id: orgA, grade_id: gradeIds['高一'], fee: 150 })).id;
  mathClass = (
    await ok('POST', '/api/students', {
      name: '高三数学班',
      type: 'class',
      org_id: orgA,
      grade_id: gradeIds['高三'],
      fee: 300,
      save_price: true,
    })
  ).id;
  const data = await ok('GET', '/api/bootstrap');
  assert.equal(data.orgs.find((o) => o.id === orgA).prices[gradeIds['高三']], 300);
  const s = data.students.find((x) => x.id === zhang);
  assert.equal(s.fee, 150);
  assert.equal(s.active, true);
  assert.equal(s.fees.length, 1);
});

test('课程创建时保存课费快照，改价目表不影响已有学员和课程', async () => {
  const { lesson } = await ok('POST', '/api/lessons', { date: '2026-10-13', start: '08:00', end: '10:00', student_id: zhang });
  assert.equal(lesson.fee, 150);
  assert.equal(lesson.status, 'normal');
  assert.equal(lesson.handout_sent, false);

  await ok('PUT', `/api/orgs/${orgA}`, { name: 'A 机构', color: 'teal', prices: { [gradeIds['高一']]: 999 } });
  const data = await ok('GET', '/api/bootstrap');
  assert.equal(data.students.find((x) => x.id === zhang).fee, 150);
  assert.equal((await lessonsOf('2026-10-13', '2026-10-13'))[0].fee, 150);
});

test('改课费：生效日期及之后的课重算，之前的课不变；之后新排的课按日期取课费', async () => {
  for (const date of ['2026-10-15', '2026-10-20', '2026-10-27']) {
    await ok('POST', '/api/lessons', { date, start: '10:00', end: '12:00', student_id: zhang });
  }
  const { updated } = await ok('POST', `/api/students/${zhang}/fee`, { fee: 180, effective_date: '2026-10-20' });
  assert.equal(updated, 2);
  const fees = Object.fromEntries((await lessonsOf('2026-10-01', '2026-10-31')).filter((l) => l.student_id === zhang).map((l) => [l.date, l.fee]));
  assert.deepEqual(fees, { '2026-10-13': 150, '2026-10-15': 150, '2026-10-20': 180, '2026-10-27': 180 });

  // 生效日期之前补排的课仍按旧课费
  const before = await ok('POST', '/api/lessons', { date: '2026-10-16', start: '14:00', end: '16:00', student_id: zhang });
  assert.equal(before.lesson.fee, 150);
  const afterL = await ok('POST', '/api/lessons', { date: '2026-10-21', start: '14:00', end: '16:00', student_id: zhang });
  assert.equal(afterL.lesson.fee, 180);
  // 移到生效日期之前的日期，课费跟着日期走
  const moved = await ok('PATCH', `/api/lessons/${afterL.lesson.id}`, { date: '2026-10-14' });
  assert.equal(moved.lesson.fee, 150);
  await ok('DELETE', `/api/lessons/${afterL.lesson.id}`);
  await ok('DELETE', `/api/lessons/${before.lesson.id}`);

  // 撤销这次改价
  const data = await ok('GET', '/api/bootstrap');
  const s = data.students.find((x) => x.id === zhang);
  assert.equal(s.fee, 180);
  const change = s.fees.find((f) => f.effective_date === '2026-10-20');
  const undo = await ok('DELETE', `/api/students/${zhang}/fee/${change.id}`);
  assert.equal(undo.updated, 2);
  const all = (await lessonsOf('2026-10-01', '2026-10-31')).filter((l) => l.student_id === zhang);
  assert.ok(all.every((l) => l.fee === 150));
  const base = s.fees.find((f) => f.effective_date === '1900-01-01');
  assert.equal((await api('DELETE', `/api/students/${zhang}/fee/${base.id}`)).status, 400);

  // 重新改回 180，后续测试沿用
  await ok('POST', `/api/students/${zhang}/fee`, { fee: 180, effective_date: '2026-10-20' });
});

test('升学：只把年级 +1，课费不变；最高年级不能再升', async () => {
  const r = await ok('POST', `/api/students/${zhang}/promote`, {});
  assert.equal(r.grade_id, gradeIds['高二']);
  const data = await ok('GET', '/api/bootstrap');
  const s = data.students.find((x) => x.id === zhang);
  assert.equal(s.grade_id, gradeIds['高二']);
  assert.equal(s.fee, 180);

  const top = await api('POST', `/api/students/${mathClass}/promote`, {});
  assert.equal(top.status, 400);
});

test('课程：调时间、取消/请假、讲义标记、上课内容', async () => {
  const [l] = await lessonsOf('2026-10-13', '2026-10-13');
  const shifted = await ok('PATCH', `/api/lessons/${l.id}`, { start: '07:50', end: '09:50' });
  assert.equal(shifted.lesson.start, '07:50');
  assert.equal(shifted.lesson.end, '09:50');
  assert.equal((await api('PATCH', `/api/lessons/${l.id}`, { start: '10:00', end: '09:00' })).status, 400);

  const done = await ok('PATCH', `/api/lessons/${l.id}`, { content: '讲到第三章第 5 题', handout_sent: true });
  assert.equal(done.lesson.content, '讲到第三章第 5 题');
  assert.equal(done.lesson.handout_sent, true);

  // 上次上课内容
  const next = (await lessonsOf('2026-10-15', '2026-10-15'))[0];
  const prev = await ok('GET', `/api/lessons/${next.id}/previous`);
  assert.equal(prev.previous.id, l.id);
  assert.equal(prev.previous.content, '讲到第三章第 5 题');
  const first = await ok('GET', `/api/lessons/${l.id}/previous`);
  assert.equal(first.previous, null);

  const cancelled = await ok('PATCH', `/api/lessons/${next.id}`, { status: 'cancelled' });
  assert.equal(cancelled.lesson.status, 'cancelled');
});

test('套用往周：只复制正常课程的学员和时间，支持只填空格和覆盖', async () => {
  // 来源周 2026-10-12（周一）～10-18：13 号正常（有内容）、15 号已取消
  await ok('POST', '/api/lessons', { date: '2026-10-17', start: '08:00', end: '10:00', student_id: mathClass });
  // 目标周已有一节 21 号（周三）14:00 和一节 24 号（周六）08:30
  const blocker = await ok('POST', '/api/lessons', { date: '2026-10-24', start: '08:30', end: '10:30', student_id: zhang });

  const filled = await ok('POST', '/api/lessons/copy-week', { from: '2026-10-12', to: '2026-10-19', mode: 'fill' });
  assert.deepEqual(filled, { created: 1, deleted: 0, skipped_conflict: 1, skipped_inactive: 0 });
  const week = await lessonsOf('2026-10-19', '2026-10-25');
  const copied = week.find((l) => l.date === '2026-10-20' && l.start === '07:50');
  assert.ok(copied, '13 号的课应复制到 20 号');
  assert.equal(copied.content, '');
  assert.equal(copied.handout_sent, false);
  assert.equal(copied.fee, 180, '复制的课按新日期取课费');
  assert.ok(!week.some((l) => l.date === '2026-10-22'), '已取消的课不复制');

  const over = await ok('POST', '/api/lessons/copy-week', { from: '2026-10-12', to: '2026-10-19', mode: 'overwrite' });
  assert.equal(over.deleted, week.length);
  assert.equal(over.created, 2);
  const after2 = await lessonsOf('2026-10-19', '2026-10-25');
  assert.equal(after2.length, 2);
  assert.ok(!after2.some((l) => l.id === blocker.lesson.id));

  // 停课学员不复制
  await ok('PUT', `/api/students/${mathClass}`, { active: false });
  const skip = await ok('POST', '/api/lessons/copy-week', { from: '2026-10-12', to: '2026-11-02', mode: 'fill' });
  assert.equal(skip.skipped_inactive, 1);
  assert.equal(skip.created, 1);
  await ok('PUT', `/api/students/${mathClass}`, { active: true });

  assert.equal((await api('POST', '/api/lessons/copy-week', { from: '2026-10-12', to: '2026-10-12' })).status, 400);
});

test('补发提醒：有"需要补发"记录且下一节课在两天之内', async () => {
  const [l] = await lessonsOf('2026-10-13', '2026-10-13');
  await ok('PATCH', `/api/lessons/${l.id}`, { needs_resend: true });

  // 张三下一节正常课是 10-20（10-15 已取消）
  let r = await ok('GET', '/api/reminders?today=2026-10-16&now=09:00');
  assert.equal(r.reminders.length, 0, '4 天后的课不提醒');
  r = await ok('GET', '/api/reminders?today=2026-10-18&now=09:00');
  assert.equal(r.reminders.length, 1);
  assert.equal(r.reminders[0].name, '张三');
  assert.equal(r.reminders[0].next.date, '2026-10-20');
  r = await ok('GET', '/api/reminders?today=2026-10-20&now=10:00');
  assert.equal(r.reminders.length, 0, '当天课已结束后不再提醒');

  await ok('POST', `/api/students/${zhang}/resent`);
  r = await ok('GET', '/api/reminders?today=2026-10-18&now=09:00');
  assert.equal(r.reminders.length, 0);
});

test('月统计：按课程日期归属月份，返回当月课程与上月合计', async () => {
  const data = await ok('GET', '/api/stats?month=2026-10');
  const normal = data.lessons.filter((l) => l.status === 'normal');
  assert.ok(normal.length > 0);
  assert.ok(data.lessons.some((l) => l.status === 'cancelled'));
  assert.ok(data.lessons.every((l) => l.date.startsWith('2026-10')));
  const nov = await ok('GET', '/api/stats?month=2026-11');
  assert.ok(nov.lessons.every((l) => l.date.startsWith('2026-11')));
  assert.equal(nov.prev.count, normal.length);
  assert.equal((await api('GET', '/api/stats?month=2026-13')).status, 400);
});

test('年级、时间段、机构删除的保护', async () => {
  assert.equal((await api('DELETE', `/api/grades/${gradeIds['高二']}`)).status, 409);
  assert.equal((await api('DELETE', `/api/orgs/${orgA}`)).status, 409);

  const g = await ok('POST', '/api/grades', { name: '小学' });
  await ok('POST', '/api/grades/order', { ids: [g.id, ...Object.values(gradeIds)] });
  let data = await ok('GET', '/api/bootstrap');
  assert.equal(data.grades[0].name, '小学');
  await ok('DELETE', `/api/grades/${g.id}`);

  const slot = await ok('POST', '/api/slots', { start: '07:20', end: '09:20' });
  assert.equal((await api('PUT', `/api/slots/${slot.id}`, { start: '09:00', end: '08:00' })).status, 400);
  data = await ok('GET', '/api/bootstrap');
  assert.equal(data.slots[0].start, '07:20');
  await ok('DELETE', `/api/slots/${slot.id}`);
});

test('删除学员会一并删除其课程；未知接口返回 404', async () => {
  await ok('DELETE', `/api/students/${mathClass}`);
  const all = await lessonsOf('2026-10-01', '2026-11-30');
  assert.ok(!all.some((l) => l.student_id === mathClass));
  assert.equal((await api('GET', '/api/nope')).status, 404);
  assert.equal((await api('PUT', '/api/lessons')).status, 405);
  assert.equal((await api('POST', '/api/lessons', { date: '2026-02-30', start: '08:00', end: '10:00', student_id: zhang })).status, 400);
});
