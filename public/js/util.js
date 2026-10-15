// 通用工具：安全的 HTML 模板、日期时间、金额格式

/* ---------- HTML 模板（插值自动转义） ---------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
/** 标记为可信 HTML，不再转义 */
export const raw = (s) => new Raw(String(s));

function fmt(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(v);
}

/** html`<b>${name}</b>`：插值默认转义；数组会被拼接；Raw 原样输出 */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += fmt(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/* ---------- 日期 ---------- */

const pad = (n) => String(n).padStart(2, '0');

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const WEEKDAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const today = () => fmtDate(new Date());

export function nowTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

/** 周一为一周的第一天 */
export function mondayOf(s) {
  const d = parseDate(s);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return fmtDate(d);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86_400_000);
}

/** 0 = 周一 … 6 = 周日 */
export const weekdayIndex = (s) => (parseDate(s).getDay() + 6) % 7;
export const weekdayName = (s) => WEEKDAYS[weekdayIndex(s)];

export function monthDay(s) {
  const d = parseDate(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 10月15日 周三（不是今年时带上年份） */
export function longDate(s) {
  const d = parseDate(s);
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${year}${monthDay(s)} ${weekdayName(s)}`;
}

/** 今天 / 明天 / 后天 / 昨天 */
export function relativeDay(s) {
  const n = daysBetween(today(), s);
  return { '-1': '昨天', 0: '今天', 1: '明天', 2: '后天' }[n] || '';
}

/** 10月13日 – 19日 / 9月29日 – 10月5日 */
export function weekRange(start) {
  const a = parseDate(start);
  const b = parseDate(addDays(start, 6));
  const left = `${a.getMonth() + 1}月${a.getDate()}日`;
  const right = a.getMonth() === b.getMonth() ? `${b.getDate()}日` : `${b.getMonth() + 1}月${b.getDate()}日`;
  return `${left} – ${right}`;
}

export function relativeWeek(start) {
  const n = Math.round(daysBetween(mondayOf(today()), start) / 7);
  if (n === 0) return '本周';
  if (n === -1) return '上周';
  if (n === 1) return '下周';
  return n < 0 ? `${-n} 周前` : `${n} 周后`;
}

export function monthOf(s) {
  return s.slice(0, 7);
}

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

/* ---------- 时间 ---------- */

export const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
export const overlaps = (a, b) => a.start < b.end && b.start < a.end;

export function duration(start, end) {
  const n = toMin(end) - toMin(start);
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h && m ? `${h}小时${m}分` : h ? `${h}小时` : `${m}分钟`;
}

/* ---------- 金额 ---------- */

const money = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
export const yuan = (n) => `¥${money.format(Math.round((Number(n) || 0) * 100) / 100)}`;
export const num = (n) => money.format(Number(n) || 0);

/* ---------- 其他 ---------- */

export const sum = (arr, f = (x) => x) => arr.reduce((acc, x) => acc + (Number(f(x)) || 0), 0);

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** 名字的第一个字，用于头像 */
export const initial = (name) => Array.from(String(name || '?').trim())[0] || '?';
