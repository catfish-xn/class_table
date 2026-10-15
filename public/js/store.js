// 应用数据：基础数据、按周缓存的课程、提醒；以及课程的本地更新与保存
import * as api from './api.js';
import { toast } from './ui.js';
import { addDays, mondayOf, nowTime, today } from './util.js';

export const COLORS = [
  ['blue', '蓝'],
  ['teal', '青'],
  ['green', '绿'],
  ['amber', '黄'],
  ['orange', '橙'],
  ['rose', '红'],
  ['pink', '粉'],
  ['violet', '紫'],
  ['cyan', '天蓝'],
  ['indigo', '靛蓝'],
  ['brown', '棕'],
  ['slate', '灰'],
];

export const TYPE_LABEL = { one: '一对一', class: '班课' };

export const state = {
  ready: false,
  loadError: null,
  orgs: [],
  grades: [],
  slots: [],
  students: [],
  /** 周一日期 → 当周课程（按日期、时间排序） */
  weeks: new Map(),
  /** 学员 id → 该学员全部课程（倒序） */
  studentLessons: new Map(),
  reminders: [],
  lastSync: 0,
};

/** 周一日期 → 上次从服务器取数据的时间 */
const weekFetchedAt = new Map();
export const weekAge = (start) => Date.now() - (weekFetchedAt.get(start) || 0);

const byId = { orgs: new Map(), grades: new Map(), students: new Map() };
export const org = (id) => byId.orgs.get(id);
export const grade = (id) => byId.grades.get(id);
export const student = (id) => byId.students.get(id);

/* ---------- 变更通知（合并到下一帧渲染） ---------- */

const listeners = new Set();
let scheduled = false;
export const subscribe = (fn) => listeners.add(fn);
export function changed() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    listeners.forEach((fn) => fn());
  });
}

/* ---------- 加载 ---------- */

function applyBase(data) {
  state.orgs = data.orgs;
  state.grades = data.grades;
  state.slots = data.slots;
  state.students = data.students;
  byId.orgs = new Map(data.orgs.map((o) => [o.id, o]));
  byId.grades = new Map(data.grades.map((g) => [g.id, g]));
  byId.students = new Map(data.students.map((s) => [s.id, s]));
}

const sortLessons = (arr) =>
  arr.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id - b.id);

/** 首次加载：基础数据 + 指定周 + 提醒，一次请求 */
export async function loadAll(weekStart) {
  const data = await api.get(`/api/bootstrap?week=${weekStart}&today=${today()}&now=${nowTime()}`);
  applyBase(data);
  state.weeks.set(weekStart, sortLessons(data.week.lessons));
  weekFetchedAt.set(weekStart, Date.now());
  state.reminders = data.reminders;
  state.ready = true;
  state.lastSync = Date.now();
  changed();
}

export async function loadBase() {
  applyBase(await api.get('/api/bootstrap'));
  changed();
}

const weekRequests = new Map();
export function loadWeek(start) {
  if (weekRequests.has(start)) return weekRequests.get(start);
  const p = api
    .get(`/api/lessons?from=${start}&to=${addDays(start, 6)}`)
    .then(({ lessons }) => {
      state.weeks.set(start, sortLessons(lessons));
      weekFetchedAt.set(start, Date.now());
      // 还没提交的本地修改继续生效
      for (const [id, p] of pending) patchLocal(id, p.patch);
      changed();
      return state.weeks.get(start);
    })
    .finally(() => weekRequests.delete(start));
  weekRequests.set(start, p);
  return p;
}

export async function loadReminders() {
  const { reminders } = await api.get(`/api/reminders?today=${today()}&now=${nowTime()}`);
  state.reminders = reminders;
  changed();
}

export async function loadStudentLessons(id) {
  const { lessons } = await api.get(`/api/students/${id}/lessons`);
  state.studentLessons.set(id, lessons);
  changed();
  return lessons;
}

/** 回到前台/出错后：静默刷新当前看到的数据（其他学员的记录缓存直接丢弃，打开时再取） */
export async function resync(weekStart, studentId = null) {
  for (const id of [...state.studentLessons.keys()]) if (id !== studentId) state.studentLessons.delete(id);
  try {
    const tasks = [loadBase(), loadReminders()];
    if (weekStart) tasks.push(loadWeek(weekStart));
    if (studentId) tasks.push(loadStudentLessons(studentId));
    await Promise.all(tasks);
    state.lastSync = Date.now();
  } catch {
    // 网络不稳定时保持当前数据
  }
}

/* ---------- 学员课费 ---------- */

/** 某天适用的课费（课费记录中生效日期 ≤ 当天的最近一条） */
export function feeOn(s, date = today()) {
  let fee = s.fee;
  for (const f of s.fees) if (f.effective_date <= date) fee = f.fee;
  return fee;
}

/** 尚未生效的改价 */
export const futureFees = (s) => s.fees.filter((f) => f.effective_date > today());

export const priceOf = (orgId, gradeId) => org(orgId)?.prices?.[gradeId];

export function nextGrade(gradeId) {
  const i = state.grades.findIndex((g) => g.id === gradeId);
  return i >= 0 ? state.grades[i + 1] || null : null;
}

/* ---------- 课程本地缓存 ---------- */

function* cachedCopies(id) {
  for (const list of state.weeks.values()) for (const l of list) if (l.id === id) yield l;
  for (const list of state.studentLessons.values()) for (const l of list) if (l.id === id) yield l;
}

export function findLesson(id) {
  return cachedCopies(id).next().value || null;
}

export function weekLessons(start) {
  return state.weeks.get(start);
}

function patchLocal(id, patch) {
  for (const l of cachedCopies(id)) Object.assign(l, patch);
  for (const list of state.weeks.values()) sortLessons(list);
}

export function insertLocal(lesson) {
  const week = state.weeks.get(mondayOf(lesson.date));
  if (week) {
    week.push(lesson);
    sortLessons(week);
  }
  const mine = state.studentLessons.get(lesson.student_id);
  if (mine) {
    mine.push({ ...lesson });
    mine.sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));
  }
  changed();
}

export function removeLocal(id) {
  for (const [k, list] of state.weeks) state.weeks.set(k, list.filter((l) => l.id !== id));
  for (const [k, list] of state.studentLessons) state.studentLessons.set(k, list.filter((l) => l.id !== id));
  changed();
}

/* ---------- 课程保存（同一节课的连续修改合并成一次请求） ---------- */

const pending = new Map();
let onSaveError = () => {};
export const setSaveErrorHandler = (fn) => {
  onSaveError = fn;
};

/**
 * 先更新本地并刷新界面，再（可选延迟）提交到服务器。
 * 返回 Promise<lesson | null>，失败时为 null（已提示）。
 */
export function saveLesson(id, patch, { delay = 0 } = {}) {
  patchLocal(id, patch);
  changed();
  let p = pending.get(id);
  if (!p) {
    p = { patch: {}, timer: 0, waiters: [] };
    pending.set(id, p);
  }
  Object.assign(p.patch, patch);
  clearTimeout(p.timer);
  return new Promise((resolve) => {
    p.waiters.push(resolve);
    p.timer = setTimeout(() => flushLesson(id), delay);
  });
}

export async function flushLesson(id) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  let result = null;
  try {
    const { lesson } = await api.patch(`/api/lessons/${id}`, p.patch);
    // 请求期间又有新的修改：以本地为准，等下一次保存
    if (!pending.has(id)) patchLocal(id, lesson);
    result = lesson;
    if ('needs_resend' in p.patch || 'status' in p.patch || 'start' in p.patch) loadReminders().catch(() => {});
  } catch (err) {
    toast(err.message, { type: 'error' });
    onSaveError(err);
  }
  p.waiters.forEach((resolve) => resolve(result));
  changed();
}

export const hasPendingSaves = () => pending.size > 0;

export function flushAll() {
  return Promise.all([...pending.keys()].map(flushLesson));
}
