// 周课表：课程卡片、加课、调时间、课程详情（上课内容 / 讲义）、套用往周
import * as api from './api.js';
import { icon } from './icons.js';
import {
  state,
  org,
  grade,
  student,
  weekLessons,
  weekAge,
  loadWeek,
  loadReminders,
  findLesson,
  saveLesson,
  flushLesson,
  insertLocal,
  removeLocal,
  feeOn,
  changed,
  TYPE_LABEL,
} from './store.js';
import { openLayer, confirmDialog, toast, busy } from './ui.js';
import {
  html,
  raw,
  today,
  addDays,
  mondayOf,
  parseDate,
  weekdayName,
  WEEKDAYS_SHORT,
  longDate,
  monthDay,
  relativeDay,
  relativeWeek,
  weekRange,
  toMin,
  fromMin,
  overlaps,
  duration,
  yuan,
  sum,
  initial,
} from './util.js';

const STEP = 10; // ▲/▼ 每次移动的分钟数
const view = { start: null, selDay: null };

export const currentWeek = () => view.start;

/* ================= 页面 ================= */

export function enter(arg) {
  const start = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? mondayOf(arg) : mondayOf(today());
  if (view.start !== start) {
    view.start = start;
    const t = today();
    view.selDay = t >= start && t <= addDays(start, 6) ? t : start;
  }
  if (state.ready) {
    if (weekAge(start) > 10_000) loadWeek(start).catch((e) => toast(e.message, { type: 'error' }));
    // 预取相邻两周，翻页更快
    for (const d of [-7, 7]) {
      const w = addDays(start, d);
      if (!weekLessons(w)) loadWeek(w).catch(() => {});
    }
  }
}

export function render() {
  const start = view.start;
  const lessons = weekLessons(start);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const normal = (lessons || []).filter((l) => l.status === 'normal');
  const isCurrent = start === mondayOf(today());

  return html`
    <section class="page week-page">
      <header class="page-head week-head">
        <div class="wh-nav">
          <button type="button" class="icon-btn" data-act="week-prev" aria-label="上一周" title="上一周（←）">
            ${icon('left')}
          </button>
          <div class="wh-title">
            <h1 class="num">${weekRange(start)}</h1>
            <div class="wh-sub">
              <span>${parseDate(start).getFullYear()}年 · ${relativeWeek(start)}</span>
              ${isCurrent ? '' : html`<button type="button" class="link-btn" data-act="week-today">回到本周</button>`}
            </div>
          </div>
          <button type="button" class="icon-btn" data-act="week-next" aria-label="下一周" title="下一周（→）">
            ${icon('right')}
          </button>
        </div>
        <div class="wh-side">
          <div class="wh-stat" aria-label="本周统计">
            <span><b class="num">${normal.length}</b> 节</span>
            <span class="dot-sep"></span>
            <b class="num">${yuan(sum(normal, (l) => l.fee))}</b>
          </div>
          <button type="button" class="btn" data-act="copy-week">${icon('copy')}<span>套用往周</span></button>
        </div>
      </header>

      ${reminders()} ${state.students.length ? '' : onboarding()}

      <nav class="daystrip" aria-label="选择日期">
        ${dates.map((d, i) => {
          const n = (lessons || []).filter((l) => l.date === d && l.status === 'normal').length;
          return html`<button
            type="button"
            class="ds-item ${d === view.selDay ? 'is-sel' : ''} ${d === today() ? 'is-today' : ''}"
            data-act="pick-day"
            data-date="${d}"
            aria-pressed="${d === view.selDay}"
            aria-label="${longDate(d)}，${n} 节课"
          >
            <span class="ds-dow">${WEEKDAYS_SHORT[i]}</span>
            <span class="ds-num num">${parseDate(d).getDate()}</span>
            <span class="ds-dots">${Array.from({ length: Math.min(n, 4) }, () => raw('<i></i>'))}</span>
          </button>`;
        })}
      </nav>

      <div class="days ${lessons ? '' : 'is-loading'}">
        ${dates.map((d) => dayColumn(d, lessons ? lessons.filter((l) => l.date === d) : null))}
      </div>
    </section>
  `;
}

function onboarding() {
  const hasOrg = state.orgs.length > 0;
  return html`<div class="onboard card">
    <div class="ob-icon">${icon('calendar')}</div>
    <div class="ob-main">
      <h2>欢迎使用课表</h2>
      <p>三步开始：先添加机构和价目，再添加学员 / 班课，然后回到这里每天点「＋」排课。</p>
      <div class="ob-steps">
        <a class="ob-step ${hasOrg ? 'done' : ''}" href="#/settings">
          <span class="ob-n">${hasOrg ? icon('check') : '1'}</span>添加机构
        </a>
        <a class="ob-step" href="#/students"><span class="ob-n">2</span>添加学员 / 班课</a>
        <span class="ob-step"><span class="ob-n">3</span>排课</span>
      </div>
    </div>
  </div>`;
}

function reminders() {
  if (!state.reminders.length) return '';
  return html`<div class="reminders" role="status">
    ${state.reminders.map((r) => {
      const rel = relativeDay(r.next.date);
      const when = rel ? `${rel}（${weekdayName(r.next.date)}）` : weekdayName(r.next.date);
      return html`<div class="reminder">
        <span class="rm-icon">${icon('bell')}</span>
        <div class="rm-text">
          <b>${r.name}</b> ${when}的课前记得补发讲义
          <span class="rm-sub num">${monthDay(r.next.date)} ${r.next.start} 上课</span>
        </div>
        <button type="button" class="btn sm" data-act="resent" data-student="${r.student_id}">
          ${icon('check')}<span>已补发</span>
        </button>
      </div>`;
    })}
  </div>`;
}

function dayColumn(date, lessons) {
  const t = today();
  const normal = (lessons || []).filter((l) => l.status === 'normal');
  const rel = relativeDay(date);
  return html`<section
    class="day ${date === t ? 'is-today' : ''} ${date < t ? 'is-past' : ''} ${date === view.selDay ? 'is-sel' : ''}"
    data-date="${date}"
    aria-label="${longDate(date)}"
  >
    <header class="day-head">
      <span class="dh-dow">${weekdayName(date)}</span>
      <span class="dh-num num">${parseDate(date).getDate()}</span>
      ${date === t ? html`<span class="today-pill">今天</span>` : ''}
      <span class="dh-count num">${normal.length ? `${normal.length} 节` : ''}</span>
    </header>
    <header class="day-mhead">
      <div>
        <b>${monthDay(date)} ${weekdayName(date)}</b>${rel ? html`<span class="today-pill">${rel}</span>` : ''}
      </div>
      <span class="num">${normal.length ? `${normal.length} 节 · ${yuan(sum(normal, (l) => l.fee))}` : ''}</span>
    </header>
    <div class="day-body">
      ${lessons == null
        ? html`<div class="skeleton"></div><div class="skeleton short"></div>`
        : lessons.map((l) => lessonCard(l, lessons))}
      ${lessons && !lessons.length
        ? html`<div class="day-empty">${icon('sun')}<span>这天还没有课</span></div>`
        : ''}
      <button type="button" class="add-lesson" data-act="add-lesson" data-date="${date}" aria-label="${longDate(date)} 加一节课">
        ${icon('plus')}<span>加课</span>
      </button>
    </div>
  </section>`;
}

function lessonCard(l, dayLessons) {
  const s = student(l.student_id);
  const o = s && org(s.org_id);
  const g = s && grade(s.grade_id);
  const cancelled = l.status === 'cancelled';
  const conflict =
    !cancelled && dayLessons.some((x) => x.id !== l.id && x.status === 'normal' && overlaps(x, l));
  const name = s?.name ?? '（已删除的学员）';
  const flags = [
    cancelled && html`<span class="flag">已取消</span>`,
    conflict && html`<span class="flag danger" title="和同一天其他课的时间重叠">时间冲突</span>`,
    l.content && html`<span class="ficon" title="已填写上课内容" aria-label="已填写上课内容">${icon('note')}</span>`,
    l.handout_sent && html`<span class="ficon ok" title="讲义已发" aria-label="讲义已发">${icon('fileCheck')}</span>`,
    l.needs_resend && html`<span class="ficon warn" title="需要补发讲义" aria-label="需要补发讲义">${icon('fileAlert')}</span>`,
  ].filter(Boolean);
  return html`<article
    class="lesson ${cancelled ? 'is-cancelled' : ''} ${conflict ? 'is-conflict' : ''}"
    data-c="${o?.color || 'slate'}"
    data-act="open-lesson"
    data-id="${l.id}"
    tabindex="0"
    role="button"
    aria-label="${name} ${l.start} 到 ${l.end}${cancelled ? '，已取消' : ''}"
  >
    <div class="l-time num">${l.start}<span class="l-dash">–</span>${l.end}</div>
    ${cancelled
      ? ''
      : html`<div class="l-shift">
          <button type="button" class="mini" data-act="shift" data-id="${l.id}" data-d="${-STEP}" aria-label="提前 ${STEP} 分钟" title="提前 ${STEP} 分钟">
            ${icon('up')}
          </button>
          <button type="button" class="mini" data-act="shift" data-id="${l.id}" data-d="${STEP}" aria-label="推后 ${STEP} 分钟" title="推后 ${STEP} 分钟">
            ${icon('down')}
          </button>
        </div>`}
    <button type="button" class="mini del" data-act="remove-lesson" data-id="${l.id}" aria-label="删除这节课" title="删除这节课">
      ${icon('minus')}
    </button>
    <div class="l-name">
      <span class="l-name-text">${name}</span>${s?.type === 'class' ? html`<span class="l-badge">班课</span>` : ''}
    </div>
    <div class="l-meta">${[o?.name, g?.name].filter(Boolean).join(' · ')}</div>
    ${flags.length ? html`<div class="l-flags">${flags}</div>` : ''}
  </article>`;
}

/* ================= 页面操作 ================= */

function go(start) {
  location.hash = `#/week/${start}`;
}

function shiftLesson(id, delta) {
  const l = findLesson(id);
  if (!l || l.status === 'cancelled') return;
  const s = toMin(l.start) + delta;
  const e = toMin(l.end) + delta;
  if (s < 0 || e > 24 * 60) {
    toast('已经到当天的边界了');
    return;
  }
  saveLesson(id, { start: fromMin(s), end: fromMin(e) }, { delay: 600 });
}

export async function removeLesson(id) {
  const l = findLesson(id);
  if (!l) return false;
  const s = student(l.student_id);
  const ok = await confirmDialog({
    title: '删除这节课？',
    message: `${s?.name ?? ''} · ${longDate(l.date)} ${l.start}–${l.end}\n删除后不可恢复。如果只是这次不上，请打开课程选「取消 / 请假」，会保留记录且不计费。`,
    ok: '删除',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.del(`/api/lessons/${id}`);
    removeLocal(id);
    loadReminders().catch(() => {});
    toast('已删除这节课', { type: 'success' });
    return true;
  } catch (err) {
    toast(err.message, { type: 'error' });
    return false;
  }
}

export async function markResent(studentId) {
  try {
    await api.post(`/api/students/${studentId}/resent`);
    for (const list of [...state.weeks.values(), ...state.studentLessons.values()]) {
      for (const l of list) if (l.student_id === studentId) l.needs_resend = false;
    }
    const s = student(studentId);
    if (s) s.resend_count = 0;
    state.reminders = state.reminders.filter((r) => r.student_id !== studentId);
    changed();
    toast('已标记为补发', { type: 'success' });
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

export const actions = {
  'week-prev': () => go(addDays(view.start, -7)),
  'week-next': () => go(addDays(view.start, 7)),
  'week-today': () => go(mondayOf(today())),
  'pick-day': (el) => {
    view.selDay = el.dataset.date;
    changed();
  },
  shift: (el) => shiftLesson(Number(el.dataset.id), Number(el.dataset.d)),
  'remove-lesson': (el) => removeLesson(Number(el.dataset.id)),
  'open-lesson': (el) => openLesson(Number(el.dataset.id)),
  'add-lesson': (el) => openAddLesson(el.dataset.date),
  'copy-week': () => openCopyWeek(view.start),
  resent: (el) => markResent(Number(el.dataset.student)),
};

/** 手机上左右滑动切换日期 */
export function swipeDay(dir) {
  const next = addDays(view.selDay, dir);
  if (next < view.start) {
    view.selDay = next;
    go(addDays(view.start, -7));
    view.start = addDays(view.start, -7);
  } else if (next > addDays(view.start, 6)) {
    view.selDay = next;
    go(addDays(view.start, 7));
    view.start = addDays(view.start, 7);
  } else {
    view.selDay = next;
    changed();
  }
}

export function keydown(e) {
  if (e.key === 'ArrowLeft') go(addDays(view.start, -7));
  else if (e.key === 'ArrowRight') go(addDays(view.start, 7));
  else return false;
  return true;
}

/* ================= 时间选择 ================= */

/** 当天第一个还没排课的模板时段；都排满了就接在最后一节课后面 */
function defaultSlot(dayLessons) {
  const taken = dayLessons.filter((l) => l.status === 'normal');
  for (const s of state.slots) if (!taken.some((l) => overlaps(l, s))) return { start: s.start, end: s.end };
  const lastEnd = taken.reduce((m, l) => Math.max(m, toMin(l.end)), 8 * 60);
  const start = Math.min(lastEnd, 22 * 60);
  return { start: fromMin(start), end: fromMin(Math.min(start + 120, 24 * 60)) };
}

function timeStepper(start, end, { act = 'shift-time' } = {}) {
  return html`<div class="stepper">
    <button type="button" class="step-btn" data-act="${act}" data-d="${-STEP}" aria-label="提前 ${STEP} 分钟">
      ${icon('up')}<span>提前</span>
    </button>
    <div class="step-value">
      <span class="num">${start}<span class="l-dash">–</span>${end}</span>
      <small>${duration(start, end)}</small>
    </div>
    <button type="button" class="step-btn" data-act="${act}" data-d="${STEP}" aria-label="推后 ${STEP} 分钟">
      ${icon('down')}<span>推后</span>
    </button>
  </div>`;
}

function shifted(start, end, d) {
  const s = toMin(start) + d;
  const e = toMin(end) + d;
  if (s < 0 || e > 24 * 60) return null;
  return { start: fromMin(s), end: fromMin(e) };
}

/* ================= 加课 ================= */

export function openAddLesson(date) {
  const dayLessons = (weekLessons(mondayOf(date)) || []).filter((l) => l.date === date);
  const st = { ...defaultSlot(dayLessons), studentId: null, q: '' };
  const actives = state.students.filter((s) => s.active);
  const busyNormal = dayLessons.filter((l) => l.status === 'normal');

  const timeBlock = () => html`
    ${timeStepper(st.start, st.end)}
    ${state.slots.length
      ? html`<div class="slot-chips" role="group" aria-label="时间段模板">
          ${state.slots.map((s) => {
            const taken = busyNormal.some((l) => overlaps(l, s));
            const sel = s.start === st.start && s.end === st.end;
            return html`<button
              type="button"
              class="chip ${sel ? 'is-sel' : ''} ${taken ? 'is-taken' : ''}"
              data-act="pick-slot"
              data-start="${s.start}"
              data-end="${s.end}"
              title="${taken ? '这个时段已有课' : ''}"
            >
              <span class="num">${s.start}</span>
            </button>`;
          })}
        </div>`
      : ''}
  `;

  const pickList = () => {
    const q = st.q.trim().toLowerCase();
    const list = actives.filter((s) => !q || s.name.toLowerCase().includes(q) || (org(s.org_id)?.name || '').toLowerCase().includes(q));
    if (!actives.length) {
      return html`<div class="empty-mini">
        还没有在读的学员 / 班课。<a href="#/students" data-act="goto-students">去添加 ${icon('arrowRight')}</a>
      </div>`;
    }
    if (!list.length) return html`<div class="empty-mini">没有找到「${st.q}」</div>`;
    return state.orgs
      .map((o) => [o, list.filter((s) => s.org_id === o.id)])
      .filter(([, ss]) => ss.length)
      .map(
        ([o, ss]) => html`<div class="pick-group">
          <div class="pick-title" data-c="${o.color}"><i class="dot"></i>${o.name}</div>
          <div class="pick-grid">
            ${ss.map(
              (s) => html`<button
                type="button"
                class="pick ${st.studentId === s.id ? 'is-sel' : ''}"
                data-c="${o.color}"
                data-act="pick-student"
                data-id="${s.id}"
                aria-pressed="${st.studentId === s.id}"
              >
                <span class="avatar sm">${initial(s.name)}</span>
                <span class="pick-name">${s.name}</span>
                <span class="pick-sub">${[grade(s.grade_id)?.name, s.type === 'class' ? '班课' : ''].filter(Boolean).join(' · ')}</span>
                <span class="pick-check">${icon('check')}</span>
              </button>`,
            )}
          </div>
        </div>`,
      );
  };

  const foot = () => {
    const s = st.studentId && student(st.studentId);
    return html`<div class="foot-note">
        ${s ? html`<b>${s.name}</b> · ${yuan(feeOn(s, date))}/节` : '请选择学员 / 班课'}
      </div>
      <button type="button" class="btn primary" data-act="save" ${raw(s ? '' : 'disabled')}>${icon('plus')}<span>添加</span></button>`;
  };

  const layer = openLayer({
    title: '加一节课',
    sub: longDate(date),
    size: 'wide',
    body: html`
      <div class="field">
        <div class="field-label">时间</div>
        <div class="js-time">${timeBlock()}</div>
      </div>
      <div class="field">
        <div class="field-label">学员 / 班课 <span class="muted">（只显示在读）</span></div>
        ${actives.length > 8
          ? html`<label class="search">${icon('search')}<input class="input" type="search" placeholder="搜索名字或机构" /></label>`
          : ''}
        <div class="js-pick">${pickList()}</div>
      </div>
    `,
    foot: foot(),
    actions: {
      'shift-time': (el) => {
        const next = shifted(st.start, st.end, Number(el.dataset.d));
        if (!next) return toast('已经到当天的边界了');
        Object.assign(st, next);
        layer.$('.js-time').innerHTML = String(timeBlock());
      },
      'pick-slot': (el) => {
        st.start = el.dataset.start;
        st.end = el.dataset.end;
        layer.$('.js-time').innerHTML = String(timeBlock());
      },
      'pick-student': (el) => {
        st.studentId = Number(el.dataset.id);
        layer.$$('.pick').forEach((b) => {
          const on = Number(b.dataset.id) === st.studentId;
          b.classList.toggle('is-sel', on);
          b.setAttribute('aria-pressed', on);
        });
        layer.setFoot(foot());
      },
      'goto-students': () => {
        layer.close();
        location.hash = '#/students';
      },
      save: (el) =>
        busy(el, async () => {
          try {
            const { lesson } = await api.post('/api/lessons', {
              date,
              start: st.start,
              end: st.end,
              student_id: st.studentId,
            });
            insertLocal(lesson);
            layer.close();
            toast(`已添加 ${student(lesson.student_id)?.name ?? ''} ${lesson.start}–${lesson.end}`, { type: 'success' });
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        }),
    },
    onMount: (layer) => {
      layer.$('.search input')?.addEventListener('input', (e) => {
        st.q = e.target.value;
        layer.$('.js-pick').innerHTML = String(pickList());
      });
    },
  });
}

/* ================= 课程详情：上课内容与讲义 ================= */

export function openLesson(id) {
  const found = findLesson(id);
  if (!found) return;
  // 详情页使用自己的副本；每次修改同时更新副本和缓存
  const l = { ...found };
  const apply = (patch, opts) => {
    Object.assign(l, patch);
    return saveLesson(id, patch, opts);
  };
  const s = student(l.student_id);
  const o = s && org(s.org_id);
  let saveSeq = 0;

  const headInfo = () => {
    const parts = [o?.name, grade(s?.grade_id)?.name, TYPE_LABEL[s?.type], `${yuan(l.fee)}/节`];
    return html`<div class="ls-who" data-c="${o?.color || 'slate'}">
      <span class="avatar">${initial(s?.name)}</span>
      <div>
        <div class="ls-name">${s?.name ?? '（已删除的学员）'}</div>
        <div class="ls-meta">${parts.filter(Boolean).join(' · ')}</div>
      </div>
    </div>`;
  };

  const whenBlock = () => {
    const cancelled = l.status === 'cancelled';
    return html`
      ${cancelled
        ? html`<div class="notice muted">${icon('ban')}<span>这节课已<b>取消 / 请假</b>，保留记录，不计费。</span></div>`
        : ''}
      <div class="ls-when">
        <label class="date-pill" title="改到其他日期">
          ${icon('calendar')}<span>${longDate(l.date)}</span>
          <input type="date" class="date-overlay" value="${l.date}" aria-label="改日期" />
        </label>
        ${cancelled
          ? html`<div class="step-value static"><span class="num">${l.start}<span class="l-dash">–</span>${l.end}</span></div>`
          : timeStepper(l.start, l.end)}
      </div>
    `;
  };

  const toggles = () => html`
    <button type="button" class="toggle ok ${l.handout_sent ? 'is-on' : ''}" data-act="toggle-sent" aria-pressed="${l.handout_sent}">
      <span class="tg-box">${icon('check')}</span>
      <span class="tg-text"><b>讲义已发</b><small>${l.handout_sent ? '已发给学生' : '还没发'}</small></span>
    </button>
    <button type="button" class="toggle warn ${l.needs_resend ? 'is-on' : ''}" data-act="toggle-resend" aria-pressed="${l.needs_resend}">
      <span class="tg-box">${icon('check')}</span>
      <span class="tg-text"><b>需要补发</b><small>${l.needs_resend ? '下次课前会提醒' : '不需要'}</small></span>
    </button>
  `;

  const foot = () => html`
    <button type="button" class="btn ghost" data-act="toggle-cancel">
      ${l.status === 'cancelled' ? html`${icon('undo')}<span>恢复上课</span>` : html`${icon('ban')}<span>取消 / 请假</span>`}
    </button>
    <button type="button" class="btn ghost danger" data-act="delete">${icon('trash')}<span>删除</span></button>
    <span class="grow"></span>
    <button type="button" class="btn" data-act="goto-student">全部记录${icon('arrowRight')}</button>
  `;

  const refresh = () => {
    if (layer.closed) return;
    layer.$('.js-when').innerHTML = String(whenBlock());
    layer.$('.js-toggles').innerHTML = String(toggles());
    layer.setFoot(foot());
  };

  const setSaveState = (text, cls = '') => {
    const el = layer.$('.save-state');
    if (el) {
      el.textContent = text;
      el.className = `save-state ${cls}`;
    }
  };

  const layer = openLayer({
    title: '课程详情',
    sub: `${longDate(l.date)} ${l.start}–${l.end}`,
    label: `${s?.name ?? ''} 的课程`,
    body: html`
      ${headInfo()}
      <div class="js-when">${whenBlock()}</div>
      <div class="js-prev"><div class="prev-box loading"><span class="skeleton line"></span></div></div>
      <div class="field">
        <div class="field-label row">
          <span>上课内容</span>
          <span class="save-state"></span>
        </div>
        <textarea class="input textarea" rows="4" maxlength="5000" placeholder="讲了什么、没讲什么、讲到第几题…">${l.content}</textarea>
      </div>
      <div class="field">
        <div class="field-label">讲义</div>
        <div class="toggles js-toggles">${toggles()}</div>
      </div>
    `,
    foot: foot(),
    actions: {
      'shift-time': (el) => {
        const next = shifted(l.start, l.end, Number(el.dataset.d));
        if (!next) return toast('已经到当天的边界了');
        apply(next, { delay: 600 });
        layer.setTitle('课程详情', `${longDate(l.date)} ${l.start}–${l.end}`);
        refresh();
      },
      'toggle-sent': () => {
        apply({ handout_sent: !l.handout_sent });
        refresh();
      },
      'toggle-resend': async () => {
        if (!l.needs_resend) {
          const ok = await confirmDialog({
            title: '标记为需要补发讲义？',
            message: `在 ${s?.name ?? '该学员'} 下一节课前两天内，打开应用时会在顶部提醒你。补发后取消勾选即可。`,
            ok: '标记需要补发',
          });
          if (!ok) return;
        }
        apply({ needs_resend: !l.needs_resend });
        refresh();
      },
      'toggle-cancel': () => {
        const cancel = l.status !== 'cancelled';
        apply({ status: cancel ? 'cancelled' : 'normal' });
        toast(cancel ? '已标记取消 / 请假，不计费' : '已恢复上课', { type: 'success' });
        refresh();
      },
      delete: async () => {
        await flushLesson(id);
        if (await removeLesson(id)) layer.close();
      },
      'goto-student': () => {
        layer.close();
        if (s) location.hash = `#/students/${s.id}`;
      },
    },
    onMount: (layer) => {
      const ta = layer.$('textarea');
      ta.addEventListener('input', () => {
        const seq = ++saveSeq;
        setSaveState('输入中…');
        apply({ content: ta.value }, { delay: 800 }).then((res) => {
          if (seq === saveSeq) setSaveState(res ? '已保存' : '保存失败', res ? 'ok' : 'err');
        });
      });
      // 电脑上点日期也直接弹出日历
      layer.root.addEventListener('click', (e) => {
        if (!e.target.matches('.date-overlay')) return;
        try {
          e.target.showPicker();
        } catch {
          // 旧浏览器：保持默认行为
        }
      });
      layer.root.addEventListener('change', async (e) => {
        if (!e.target.matches('.date-overlay') || !e.target.value || e.target.value === l.date) return;
        const moved = await moveLesson(id, e.target.value);
        if (moved) Object.assign(l, moved);
        else e.target.value = l.date;
        layer.setTitle('课程详情', `${longDate(l.date)} ${l.start}–${l.end}`);
        refresh();
      });
    },
    onClose: () => flushLesson(id),
  });

  api
    .get(`/api/lessons/${id}/previous`)
    .then(({ previous: p }) => {
      if (layer.closed) return;
      layer.$('.js-prev').innerHTML = p
        ? String(html`<div class="prev-box">
            <div class="prev-head">
              ${icon('book')}<span>上次上课 · ${longDate(p.date)}</span>
              ${p.handout_sent ? html`<span class="flag ok">讲义已发</span>` : ''}
              ${p.needs_resend ? html`<span class="flag warn">需补发</span>` : ''}
            </div>
            <div class="prev-text">${p.content}</div>
          </div>`)
        : '';
    })
    .catch(() => {
      if (!layer.closed) layer.$('.js-prev').innerHTML = '';
    });
}

/** 改日期：课费按新日期重新取，课程移到对应的周 */
async function moveLesson(id, date) {
  await flushLesson(id);
  try {
    const { lesson } = await api.patch(`/api/lessons/${id}`, { date });
    removeLocal(id);
    insertLocal(lesson);
    loadReminders().catch(() => {});
    toast(`已改到 ${longDate(lesson.date)}`, { type: 'success' });
    return lesson;
  } catch (err) {
    toast(err.message, { type: 'error' });
    return null;
  }
}

/* ================= 套用往周 ================= */

export function openCopyWeek(target) {
  const targetLessons = weekLessons(target) || [];
  const existing = targetLessons.length;
  const st = { choice: 'w1', custom: addDays(target, -21), mode: 'fill' };
  const srcStart = () =>
    st.choice === 'w1' ? addDays(target, -7) : st.choice === 'w2' ? addDays(target, -14) : mondayOf(st.custom);

  const countOf = (start) => {
    const ls = weekLessons(start);
    if (!ls) return null;
    return ls.filter((l) => l.status === 'normal' && student(l.student_id)?.active).length;
  };
  const countText = (start) => {
    const n = countOf(start);
    return n == null ? '统计中…' : `${n} 节课`;
  };

  const option = (key, title, start, extra = '') => html`<label class="radio-card ${st.choice === key ? 'is-sel' : ''}">
    <input type="radio" name="src" value="${key}" ${raw(st.choice === key ? 'checked' : '')} />
    <span class="rc-dot"></span>
    <span class="rc-main">
      <span class="rc-title">${title}</span>
      <span class="rc-sub num">${weekRange(start)} · ${countText(start)}</span>
      ${extra}
    </span>
  </label>`;

  const body = () => html`
    <div class="copy-target">
      ${icon('calendar')}
      <span>复制到 <b>${relativeWeek(target)}</b> <span class="num">${weekRange(target)}</span>
        ${existing ? html`<span class="muted">（已有 ${existing} 节）</span>` : ''}</span>
    </div>
    <div class="field">
      <div class="field-label">从哪一周复制</div>
      <div class="radio-cards">
        ${option('w1', '上周', addDays(target, -7))}
        ${option('w2', '上上周', addDays(target, -14))}
        ${option(
          'custom',
          '其他周',
          mondayOf(st.custom),
          html`<input type="date" class="input sm js-custom" value="${st.custom}" aria-label="选择任意一天，复制那一周" />`,
        )}
      </div>
    </div>
    ${existing
      ? html`<div class="field">
          <div class="field-label">本周已经有 ${existing} 节课，怎么处理？</div>
          <div class="radio-cards">
            <label class="radio-card ${st.mode === 'fill' ? 'is-sel' : ''}">
              <input type="radio" name="mode" value="fill" ${raw(st.mode === 'fill' ? 'checked' : '')} />
              <span class="rc-dot"></span>
              <span class="rc-main">
                <span class="rc-title">只填空格</span>
                <span class="rc-sub">保留本周已有的课，时间冲突的课跳过</span>
              </span>
            </label>
            <label class="radio-card danger ${st.mode === 'overwrite' ? 'is-sel' : ''}">
              <input type="radio" name="mode" value="overwrite" ${raw(st.mode === 'overwrite' ? 'checked' : '')} />
              <span class="rc-dot"></span>
              <span class="rc-main">
                <span class="rc-title">覆盖</span>
                <span class="rc-sub">先删除本周已有的 ${existing} 节课（包括上课记录），再复制</span>
              </span>
            </label>
          </div>
        </div>`
      : ''}
    <p class="hint">
      只复制学员和上课时间，不复制上课内容和讲义记录；已取消的课和已停课的学员不会复制。复制后遇到节假日，可以再单独取消或删除个别课程。
    </p>
  `;

  const foot = () => {
    const n = countOf(srcStart());
    const same = srcStart() === target;
    return html`<button type="button" class="btn" data-close>取消</button>
      <button type="button" class="btn primary" data-act="apply" ${raw(n && !same ? '' : 'disabled')}>
        ${icon('copy')}<span>${same ? '不能复制到同一周' : n === 0 ? '这周没有课可复制' : '开始套用'}</span>
      </button>`;
  };

  const ensure = (start) => {
    if (!weekLessons(start))
      loadWeek(start)
        .then(update)
        .catch(() => {});
  };

  const update = () => {
    if (layer.closed) return;
    const focusedCustom = document.activeElement?.classList.contains('js-custom');
    layer.setBody(body());
    layer.setFoot(foot());
    if (focusedCustom) layer.$('.js-custom')?.focus();
  };

  const layer = openLayer({
    title: '套用往周',
    sub: '把往周的排课复制到当前这周',
    body: body(),
    foot: foot(),
    actions: {
      apply: async (el) => {
        if (st.mode === 'overwrite' && existing) {
          const ok = await confirmDialog({
            title: `覆盖本周的 ${existing} 节课？`,
            message: '本周已有的课程会被删除（包括已填写的上课内容），然后复制所选那周的排课。',
            ok: '覆盖',
            danger: true,
          });
          if (!ok) return;
        }
        await busy(el, async () => {
          try {
            const r = await api.post('/api/lessons/copy-week', { from: srcStart(), to: target, mode: existing ? st.mode : 'fill' });
            await loadWeek(target);
            loadReminders().catch(() => {});
            layer.close();
            const skipped = [
              r.skipped_conflict ? `${r.skipped_conflict} 节时间冲突` : '',
              r.skipped_inactive ? `${r.skipped_inactive} 节已停课` : '',
            ].filter(Boolean);
            toast(`已复制 ${r.created} 节课${skipped.length ? `，跳过 ${skipped.join('、')}` : ''}`, {
              type: 'success',
              duration: 3600,
            });
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        });
      },
    },
    onMount: (layer) => {
      layer.root.addEventListener('change', (e) => {
        if (e.target.name === 'src') st.choice = e.target.value;
        else if (e.target.name === 'mode') st.mode = e.target.value;
        else if (e.target.classList.contains('js-custom') && e.target.value) {
          st.custom = e.target.value;
          st.choice = 'custom';
        } else return;
        ensure(srcStart());
        update();
      });
    },
  });

  [addDays(target, -7), addDays(target, -14), mondayOf(st.custom)].forEach(ensure);
}
