// 入口：导航、路由、全局事件、启动加载
import { icon } from './icons.js';
import { state, subscribe, loadAll, resync, flushAll, setSaveErrorHandler } from './store.js';
import { hasLayer, closeAllLayers } from './ui.js';
import { html, mondayOf, today } from './util.js';
import * as week from './week.js';
import * as students from './students.js';
import * as stats from './stats.js';
import * as settings from './settings.js';

const views = { week, students, stats, settings };
const TABS = [
  ['week', '课表', 'calendar'],
  ['students', '学员', 'users'],
  ['stats', '统计', 'chart'],
  ['settings', '设置', 'sliders'],
];
const TITLES = { week: '课表', students: '学员', stats: '月统计', settings: '设置' };

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: views[parts[0]] ? parts[0] : 'week', arg: parts[1] ? decodeURIComponent(parts[1]) : null };
}

const tabHref = (name) => (name === 'week' && week.currentWeek() ? `#/week/${week.currentWeek()}` : `#/${name}`);

function chrome() {
  document.getElementById('topbar').innerHTML = String(html`
    <a class="brand" href="#/week"><span class="brand-logo">${icon('calendar')}</span>课表</a>
    <nav class="nav" aria-label="主导航">
      ${TABS.map(([k, label, ic]) => html`<a href="#/${k}" data-tab="${k}">${icon(ic)}<span>${label}</span></a>`)}
    </nav>
    <div class="topbar-note">${icon('cloud')}<span>云端同步</span></div>
  `);
  document.getElementById('tabbar').innerHTML = String(
    html`${TABS.map(([k, label, ic]) => html`<a href="#/${k}" data-tab="${k}">${icon(ic)}<span>${label}</span></a>`)}`,
  );
}

function updateNav(r) {
  document.querySelectorAll('[data-tab]').forEach((a) => {
    const on = a.dataset.tab === r.name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    a.setAttribute('href', tabHref(a.dataset.tab));
  });
}

const loadingView = () => html`<div class="loading-screen">
  <div style="display:grid;place-items:center;gap:14px">
    <span class="brand-logo">${icon('calendar')}</span><span>正在加载课表…</span>
  </div>
</div>`;

const errorView = () => html`<div class="page narrow">
  <div class="empty card" style="margin-top:48px">
    ${icon('cloud')}
    <h3>加载失败</h3>
    <p>${state.loadError}</p>
    <button type="button" class="btn primary" data-act="retry">重新加载</button>
  </div>
</div>`;

function render() {
  const r = parseRoute();
  updateNav(r);
  const el = document.getElementById('view');
  if (!state.ready) {
    el.innerHTML = String(state.loadError ? errorView() : loadingView());
    return;
  }
  // 重新渲染时保留输入框焦点（例如搜索框）
  const active = document.activeElement;
  const keep = active && active.id && el.contains(active) ? active : null;
  const range = keep && 'selectionStart' in keep ? [keep.selectionStart, keep.selectionEnd] : null;
  el.innerHTML = String(views[r.name].render(r.arg));
  views[r.name].mounted?.(el, r.arg);
  if (keep) {
    const again = document.getElementById(keep.id);
    if (again) {
      again.focus({ preventScroll: true });
      try {
        if (range) again.setSelectionRange(...range);
      } catch {
        // 某些输入类型不支持
      }
    }
  }
}

let current = null;
function onRoute() {
  const r = parseRoute();
  const key = `${r.name}/${r.arg || ''}`;
  if (key !== current) {
    const prevPage = current?.split('/')[0];
    current = key;
    // 手机上按返回键切换页面时，不让弹层停留在别的页面上
    if (hasLayer()) closeAllLayers();
    views[r.name].enter?.(r.arg);
    if (prevPage !== r.name || r.name === 'students') window.scrollTo(0, 0);
    document.title = r.name === 'week' ? '课表' : `${TITLES[r.name]} · 课表`;
  }
  render();
}

/** 当前打开的学员详情（用于同步时只刷新这个学员的记录） */
function currentStudentId() {
  const r = parseRoute();
  return r.name === 'students' && Number(r.arg) ? Number(r.arg) : null;
}

const globalActions = {
  retry: () => boot(),
};

/* ---------- 全局事件 ---------- */

document.addEventListener('click', (e) => {
  if (e.target.closest('#overlays')) return;
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const r = parseRoute();
  const fn = views[r.name].actions?.[el.dataset.act] || globalActions[el.dataset.act];
  if (fn) {
    e.preventDefault();
    fn(el, e);
  }
});

document.addEventListener('keydown', (e) => {
  if (hasLayer()) return;
  const t = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[role="button"][data-act]')) {
    e.preventDefault();
    t.click();
    return;
  }
  if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (parseRoute().name === 'week' && week.keydown(e)) e.preventDefault();
});

// 手机上在课程列表区域左右滑动切换日期
let touch = null;
document.addEventListener(
  'touchstart',
  (e) => {
    touch = null;
    if (hasLayer() || e.touches.length !== 1 || matchMedia('(min-width: 1100px)').matches) return;
    if (!e.target.closest('.days, .daystrip')) return;
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  },
  { passive: true },
);
document.addEventListener(
  'touchend',
  (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    const quick = Date.now() - touch.t < 700;
    touch = null;
    if (quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) week.swipeDay(dx < 0 ? 1 : -1);
  },
  { passive: true },
);

// 切回页面时同步另一台设备上的修改；离开时把未提交的修改发出去
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushAll();
  } else if (state.ready && Date.now() - state.lastSync > 15_000) {
    resync(week.currentWeek(), currentStudentId());
    if (parseRoute().name === 'stats') stats.refresh();
  }
});
window.addEventListener('pagehide', () => flushAll());

setSaveErrorHandler(() => resync(week.currentWeek(), currentStudentId()));
subscribe(render);
window.addEventListener('hashchange', onRoute);

/* ---------- 启动 ---------- */

async function boot() {
  chrome();
  state.loadError = null;
  render();
  const r = parseRoute();
  const start = r.name === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(r.arg || '') ? mondayOf(r.arg) : mondayOf(today());
  try {
    await loadAll(start);
  } catch (err) {
    state.loadError = err.message;
    render();
    return;
  }
  current = null;
  onRoute();
}

boot();
