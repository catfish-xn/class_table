// 月统计：按课程日期归属月份，只统计正常的课
import * as api from './api.js';
import { icon } from './icons.js';
import { state, org, grade, student, changed } from './store.js';
import { toast } from './ui.js';
import { openExport } from './report.js';
import { html, today, nowTime, monthOf, addMonths, monthLabel, parseDate, yuan, num, sum, initial } from './util.js';

const view = { month: null, data: null, open: new Set() };

export function enter(arg) {
  view.month = /^\d{4}-(0[1-9]|1[0-2])$/.test(arg || '') ? arg : monthOf(today());
  if (state.ready) load();
}

async function load() {
  const month = view.month;
  try {
    const data = await api.get(`/api/stats?month=${month}`);
    if (month === view.month) {
      view.data = data;
      changed();
    }
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

/** 课程变动后刷新（例如从其他页面回来） */
export const refresh = () => view.month && load();

export function render() {
  const month = view.month;
  const d = view.data?.month === month ? view.data : null;
  const isCurrent = month === monthOf(today());
  return html`<section class="page narrow">
    <header class="page-head">
      <div class="month-nav">
        <button type="button" class="icon-btn" data-act="month" data-d="-1" aria-label="上个月">${icon('left')}</button>
        <div class="month-title">
          <h1 class="num">${monthLabel(month)}</h1>
          <div class="wh-sub">
            <span>${relativeMonth(month)}</span>
            ${isCurrent ? '' : html`<button type="button" class="link-btn" data-act="month-now">回到本月</button>`}
          </div>
        </div>
        <button type="button" class="icon-btn" data-act="month" data-d="1" aria-label="下个月">${icon('right')}</button>
      </div>
      <button type="button" class="btn primary" data-act="export" ${d && d.lessons.length ? '' : 'disabled'}>
        ${icon('image')}<span>导出图片</span>
      </button>
    </header>
    ${d ? body(d) : html`<div class="skeleton" style="height:150px;border-radius:26px"></div><div class="skeleton"></div>`}
  </section>`;
}

function relativeMonth(month) {
  const [y1, m1] = monthOf(today()).split('-').map(Number);
  const [y2, m2] = month.split('-').map(Number);
  const n = (y2 - y1) * 12 + (m2 - m1);
  if (n === 0) return '本月';
  if (n === -1) return '上个月';
  if (n === 1) return '下个月';
  return n < 0 ? `${-n} 个月前` : `${n} 个月后`;
}

function body(d) {
  const normal = d.lessons.filter((l) => l.status === 'normal');
  const cancelled = d.lessons.length - normal.length;
  const total = sum(normal, (l) => l.fee);
  const nowKey = `${today()} ${nowTime()}`;
  const done = normal.filter((l) => `${l.date} ${l.end}` <= nowKey).length;
  const prev = d.prev || { count: 0, total: 0 };
  const delta = total - prev.total;

  // 按学员
  const byStudent = new Map();
  for (const l of normal) {
    const r = byStudent.get(l.student_id) || { id: l.student_id, count: 0, fee: 0, days: [] };
    r.count++;
    r.fee += l.fee;
    r.days.push(parseDate(l.date).getDate());
    byStudent.set(l.student_id, r);
  }
  const students = [...byStudent.values()].sort((a, b) => b.fee - a.fee || b.count - a.count);

  // 按机构
  const byOrg = new Map();
  for (const r of students) {
    const orgId = student(r.id)?.org_id ?? 0;
    const o = byOrg.get(orgId) || { id: orgId, count: 0, fee: 0, students: [] };
    o.count += r.count;
    o.fee += r.fee;
    o.students.push(r);
    byOrg.set(orgId, o);
  }
  const orgs = [...byOrg.values()].sort((a, b) => b.fee - a.fee);

  return html`
    <div class="hero">
      <div class="hero-label">${icon('wallet')}<span>${monthLabel(d.month)} 课时费</span></div>
      <div class="hero-value num">${yuan(total)}</div>
      <div class="hero-sub">
        <span>共 <b class="num">${normal.length}</b> 节课</span>
        ${prev.count || prev.total
          ? html`<span class="delta num">
              ${delta >= 0 ? icon('arrowUp') : icon('arrowDown')}较上月 ${delta >= 0 ? '+' : '−'}${yuan(Math.abs(delta))}
            </span>`
          : ''}
      </div>
    </div>

    <div class="mini-stats">
      <div class="stat"><div class="stat-label">总节数</div><div class="stat-value num">${normal.length}<small>节</small></div></div>
      <div class="stat"><div class="stat-label">已上</div><div class="stat-value num">${done}<small>节</small></div></div>
      <div class="stat"><div class="stat-label">待上</div><div class="stat-value num">${normal.length - done}<small>节</small></div></div>
      <div class="stat"><div class="stat-label">取消 / 请假</div><div class="stat-value num">${cancelled}<small>节</small></div></div>
    </div>

    ${normal.length
      ? html`
          <div class="section-title"><span>按机构</span><small>点开查看包含哪些学员</small></div>
          <div class="card org-card">
            <div class="share-bar" aria-hidden="true">
              ${orgs.map((o) => html`<i data-c="${org(o.id)?.color || 'slate'}" style="flex:${o.fee || o.count}"></i>`)}
            </div>
            ${orgs.map((o) => orgRow(o, total))}
          </div>

          <div class="section-title"><span>按学员</span><small>${students.length} 个学员 / 班课</small></div>
          <div class="card" style="overflow:hidden">${students.map(studentRow)}</div>
        `
      : html`<div class="empty card" style="margin-top:16px">
          ${icon('chart')}
          <h3>这个月还没有课</h3>
          <p>在课表里排课后，这里会自动统计节数和课时费。</p>
        </div>`}
  `;
}

function orgRow(o, total) {
  const info = org(o.id);
  const open = view.open.has(o.id);
  const share = total ? Math.round((o.fee / total) * 100) : 0;
  return html`<div class="ostat ${open ? 'open' : ''}" data-c="${info?.color || 'slate'}">
    <button type="button" class="ostat-row" data-act="toggle-org" data-id="${o.id}" aria-expanded="${open}">
      <span class="ostat-bar"></span>
      <span class="ostat-main">
        <span class="ostat-name">${info?.name ?? '其他'}</span>
        <span class="ostat-sub num" style="display:block">${o.count} 节 · ${o.students.length} 个学员 · 占 ${share}%</span>
      </span>
      <span class="ostat-fee num">${yuan(o.fee)}</span>
      <span class="ostat-chev">${icon('right')}</span>
    </button>
    <div class="ostat-students">
      ${o.students.map(
        (r) => html`<div class="ss-row">
          <span class="ss-name">
            ${student(r.id)?.name ?? '（已删除）'}
            <small class="ss-days num">${r.days.join('、')} 日</small>
          </span>
          <span class="ss-count num">${r.count} 节</span>
          <span class="ss-fee num">${yuan(r.fee)}</span>
        </div>`,
      )}
      <button type="button" class="btn sm ss-export" data-act="export" data-org="${o.id}">
        ${icon('image')}<span>导出这个机构的统计图片</span>
      </button>
    </div>
  </div>`;
}

function studentRow(r) {
  const s = student(r.id);
  const o = s && org(s.org_id);
  return html`<a class="stu-stat" href="${s ? `#/students/${s.id}` : '#/stats'}" data-c="${o?.color || 'slate'}">
    <span class="avatar sm">${initial(s?.name)}</span>
    <span class="st-main">
      <span class="st-name" style="display:block">${s?.name ?? '（已删除）'}</span>
      <span class="st-sub" style="display:block">${[o?.name, grade(s?.grade_id)?.name].filter(Boolean).join(' · ')}</span>
    </span>
    <span class="st-count num">${num(r.count)} 节</span>
    <span class="st-fee num">${yuan(r.fee)}</span>
  </a>`;
}

export const actions = {
  export: (el) => {
    const d = view.data?.month === view.month ? view.data : null;
    if (!d || !d.lessons.length) return toast('这个月还没有课，没有可导出的内容');
    openExport({ month: d.month, lessons: d.lessons, orgId: el.dataset.org ? Number(el.dataset.org) : null });
  },
  month: (el) => {
    location.hash = `#/stats/${addMonths(view.month, Number(el.dataset.d))}`;
  },
  'month-now': () => {
    location.hash = `#/stats/${monthOf(today())}`;
  },
  'toggle-org': (el) => {
    const id = Number(el.dataset.id);
    if (view.open.has(id)) view.open.delete(id);
    else view.open.add(id);
    changed();
  },
};
