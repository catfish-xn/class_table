// 学员 / 班课：列表、详情（上课记录）、新增编辑、升学、改课费
import * as api from './api.js';
import { icon } from './icons.js';
import {
  state,
  org,
  grade,
  student,
  feeOn,
  futureFees,
  priceOf,
  nextGrade,
  loadBase,
  loadWeek,
  loadStudentLessons,
  changed,
  TYPE_LABEL,
} from './store.js';
import { openLayer, confirmDialog, toast, busy } from './ui.js';
import { openLesson, markResent } from './week.js';
import { html, raw, today, nowTime, monthDay, longDate, weekdayName, parseDate, monthOf, yuan, initial } from './util.js';

const ui = { filter: 'active', q: '' };

/* ================= 列表 ================= */

export function enter(arg) {
  const id = Number(arg);
  if (id && state.ready) loadStudentLessons(id).catch((e) => toast(e.message, { type: 'error' }));
}

export function render(arg) {
  const id = Number(arg);
  return id ? detail(id) : list();
}

function list() {
  const all = state.students;
  const n = {
    active: all.filter((s) => s.active).length,
    inactive: all.filter((s) => !s.active).length,
    all: all.length,
  };
  return html`<section class="page narrow">
    <header class="page-head">
      <div>
        <h1>学员 / 班课</h1>
        <div class="page-sub">${n.active} 个在读${n.inactive ? ` · ${n.inactive} 个停课` : ''}</div>
      </div>
      <button type="button" class="btn primary" data-act="new-student">${icon('plus')}<span>新增</span></button>
    </header>
    ${all.length
      ? html`<div class="toolbar">
          <div class="seg" role="group" aria-label="筛选">
            ${[
              ['active', '在读'],
              ['inactive', '停课'],
              ['all', '全部'],
            ].map(
              ([k, label]) => html`<button type="button" class="${ui.filter === k ? 'is-on' : ''}" data-act="filter" data-v="${k}" aria-pressed="${ui.filter === k}">
                ${label}<small class="num">${n[k]}</small>
              </button>`,
            )}
          </div>
          <label class="search">
            ${icon('search')}
            <input id="student-search" class="input" type="search" placeholder="搜索名字" value="${ui.q}" autocomplete="off" />
          </label>
        </div>
        <div class="js-groups">${groups()}</div>`
      : emptyState()}
  </section>`;
}

function emptyState() {
  if (!state.orgs.length) {
    return html`<div class="empty card">
      ${icon('building')}
      <h3>先添加一个机构</h3>
      <p>学员 / 班课都属于某个机构，课费也可以按机构价目自动带出。</p>
      <a class="btn primary" href="#/settings">${icon('plus')}<span>去添加机构</span></a>
    </div>`;
  }
  return html`<div class="empty card">
    ${icon('users')}
    <h3>还没有学员 / 班课</h3>
    <p>班课当作一个整体，和学员一样按节计费。</p>
    <button type="button" class="btn primary" data-act="new-student">${icon('plus')}<span>新增学员 / 班课</span></button>
  </div>`;
}

function groups() {
  const q = ui.q.trim().toLowerCase();
  const rows = state.students.filter(
    (s) =>
      (ui.filter === 'all' || (ui.filter === 'active') === s.active) && (!q || s.name.toLowerCase().includes(q)),
  );
  if (!rows.length) {
    return html`<div class="empty-mini">${q ? `没有找到「${ui.q}」` : ui.filter === 'inactive' ? '没有停课的学员' : '没有在读的学员'}</div>`;
  }
  return state.orgs
    .map((o) => [o, rows.filter((s) => s.org_id === o.id)])
    .filter(([, ss]) => ss.length)
    .map(
      ([o, ss]) => html`<div class="group">
        <div class="group-head" data-c="${o.color}"><i class="dot"></i>${o.name}<span class="muted num">${ss.length}</span></div>
        <div class="list">${ss.map(studentRow)}</div>
      </div>`,
    );
}

function studentRow(s) {
  const o = org(s.org_id);
  const future = futureFees(s)[0];
  return html`<div
    class="srow ${s.active ? '' : 'is-inactive'}"
    data-c="${o?.color || 'slate'}"
    data-act="open-student"
    data-id="${s.id}"
    role="button"
    tabindex="0"
  >
    <span class="avatar">${initial(s.name)}</span>
    <div class="srow-main">
      <div class="srow-title">
        <span>${s.name}</span>
        ${s.type === 'class' ? html`<span class="tag c">班课</span>` : ''}
        ${s.active ? '' : html`<span class="tag">停课</span>`}
        ${s.resend_count ? html`<span class="tag warn">待补发</span>` : ''}
      </div>
      <div class="srow-sub num">
        ${grade(s.grade_id)?.name || '未设年级'} · ${yuan(feeOn(s))}/节
        ${future ? html`<span class="future">· ${monthDay(future.effective_date)}起 ${yuan(future.fee)}</span>` : ''}
      </div>
    </div>
    <div class="srow-actions">
      <button type="button" class="btn sm" data-act="promote" data-id="${s.id}">${icon('cap')}<span>升学</span></button>
      <button type="button" class="btn sm" data-act="change-fee" data-id="${s.id}">${icon('tag')}<span>改课费</span></button>
    </div>
  </div>`;
}

/* ================= 详情 ================= */

function detail(id) {
  const s = student(id);
  if (!s) {
    return html`<section class="page narrow">
      <a class="back" href="#/students">${icon('left')}学员</a>
      <div class="empty card">${icon('users')}<h3>找不到这个学员</h3><p>可能已经被删除了。</p></div>
    </section>`;
  }
  const o = org(s.org_id);
  const lessons = state.studentLessons.get(id);
  const nowKey = `${today()} ${nowTime()}`;
  const isPast = (l) => `${l.date} ${l.end}` <= nowKey;
  const past = lessons ? lessons.filter(isPast) : [];
  const upcoming = lessons ? lessons.filter((l) => !isPast(l) && l.status === 'normal').reverse().slice(0, 4) : [];
  const done = past.filter((l) => l.status === 'normal');
  const thisMonth = (lessons || []).filter((l) => l.status === 'normal' && monthOf(l.date) === monthOf(today()));
  const pendingResend = (lessons || []).filter((l) => l.needs_resend).length || s.resend_count;

  return html`<section class="page narrow" data-c="${o?.color || 'slate'}">
    <a class="back" href="#/students">${icon('left')}学员</a>

    <div class="profile card">
      <span class="avatar lg">${initial(s.name)}</span>
      <div class="pf-main">
        <h1>
          ${s.name}
          <span class="tag c">${TYPE_LABEL[s.type]}</span>
          ${s.active ? html`<span class="tag ok">在读</span>` : html`<span class="tag">停课</span>`}
        </h1>
        <div class="pf-meta">${[o?.name, grade(s.grade_id)?.name].filter(Boolean).join(' · ')}</div>
      </div>
      <div class="pf-actions">
        <button type="button" class="btn" data-act="promote" data-id="${s.id}">${icon('cap')}<span>升学</span></button>
        <button type="button" class="btn" data-act="change-fee" data-id="${s.id}">${icon('tag')}<span>改课费</span></button>
        <button type="button" class="btn" data-act="edit-student" data-id="${s.id}">${icon('pencil')}<span>编辑</span></button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat">
        <div class="stat-label">当前课费</div>
        <div class="stat-value num">${yuan(feeOn(s))}<small>/节</small></div>
      </div>
      <div class="stat">
        <div class="stat-label">已上课</div>
        <div class="stat-value num">${lessons ? done.length : '–'}<small>节</small></div>
      </div>
      <div class="stat">
        <div class="stat-label">本月</div>
        <div class="stat-value num">${lessons ? thisMonth.length : '–'}<small>节</small></div>
      </div>
    </div>

    ${pendingResend
      ? html`<div class="notice warn">
          ${icon('fileAlert')}<span>有 ${pendingResend} 节课的讲义需要补发</span>
          <button type="button" class="btn sm" data-act="resent" data-id="${s.id}">${icon('check')}<span>已补发</span></button>
        </div>`
      : ''}

    ${s.fees.length > 1 ? feeHistory(s) : ''}

    ${upcoming.length
      ? html`<div class="section-title">接下来</div>
          <div class="upcoming">
            ${upcoming.map(
              (l) => html`<div class="up-card" data-act="open-record" data-id="${l.id}" role="button" tabindex="0">
                <b>${monthDay(l.date)} ${weekdayName(l.date)}</b>
                <span class="num">${l.start}–${l.end}</span>
              </div>`,
            )}
          </div>`
      : ''}

    <div class="section-title">
      <span>上课记录</span>
      ${lessons ? html`<small>${past.length} 条 · 最近的在最上面</small>` : ''}
    </div>
    ${lessons == null
      ? html`<div class="skeleton"></div><div class="skeleton"></div>`
      : past.length
        ? html`<div class="records">${past.map(record)}</div>`
        : html`<div class="empty-mini">还没有上过课。在课表里加课后，上完课点开课程就能写上课内容。</div>`}
  </section>`;
}

function feeHistory(s) {
  const rows = [...s.fees].reverse();
  const t = today();
  return html`<div class="section-title">
      <span>课费记录</span><small>改课费只影响生效日期及之后的课</small>
    </div>
    <div class="card fee-list">
      ${rows.map((f, i) => {
        const base = f.effective_date === '1900-01-01';
        const pending = f.effective_date > t;
        return html`<div class="fee-row">
          <span class="fee-date num">${base ? '最初' : `${longDate(f.effective_date)} 起`}</span>
          ${pending ? html`<span class="tag c">待生效</span>` : i === rows.findIndex((x) => x.effective_date <= t) ? html`<span class="tag ok">当前</span>` : ''}
          <b class="num">${yuan(f.fee)}</b>
          ${base
            ? html`<span style="width:34px"></span>`
            : html`<button type="button" class="icon-btn ghost" data-act="undo-fee" data-id="${s.id}" data-fee="${f.id}" aria-label="撤销这次改价" title="撤销这次改价">
                ${icon('undo')}
              </button>`}
        </div>`;
      })}
    </div>`;
}

function record(l) {
  const d = parseDate(l.date);
  const cancelled = l.status === 'cancelled';
  return html`<article class="record ${cancelled ? 'is-cancelled' : ''}" data-act="open-record" data-id="${l.id}" role="button" tabindex="0">
    <div class="rec-date">
      <span class="rec-day num">${d.getDate()}</span>
      <span class="rec-mon">${d.getMonth() + 1}月 · ${weekdayName(l.date).slice(1)}</span>
    </div>
    <div>
      <div class="rec-head">
        <span class="num">${l.start}–${l.end}</span>
        ${d.getFullYear() !== new Date().getFullYear() ? html`<span>${d.getFullYear()}年</span>` : ''}
        ${cancelled ? html`<span class="flag">已取消</span>` : ''}
        ${l.handout_sent ? html`<span class="flag ok">讲义已发</span>` : ''}
        ${l.needs_resend ? html`<span class="flag warn">需补发</span>` : ''}
      </div>
      <div class="rec-content ${l.content ? '' : 'is-empty'}">${l.content || (cancelled ? '取消 / 请假' : '未填写上课内容')}</div>
    </div>
  </article>`;
}

/* ================= 操作 ================= */

export const actions = {
  filter: (el) => {
    ui.filter = el.dataset.v;
    changed();
  },
  'new-student': () => openStudentForm(),
  'open-student': (el) => {
    location.hash = `#/students/${el.dataset.id}`;
  },
  'edit-student': (el) => openStudentForm(Number(el.dataset.id)),
  promote: (el) => openPromote(Number(el.dataset.id)),
  'change-fee': (el) => openChangeFee(Number(el.dataset.id)),
  'open-record': (el) => openLesson(Number(el.dataset.id)),
  resent: (el) => markResent(Number(el.dataset.id)),
  'undo-fee': async (el) => {
    const s = student(Number(el.dataset.id));
    const f = s?.fees.find((x) => x.id === Number(el.dataset.fee));
    if (!f) return;
    const ok = await confirmDialog({
      title: '撤销这次改价？',
      message: `${longDate(f.effective_date)} 起的课费 ${yuan(f.fee)} 将被撤销，这之后的课会按之前的课费重新计算。`,
      ok: '撤销',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.del(`/api/students/${s.id}/fee/${f.id}`);
      await afterFeeChange(s.id);
      toast(`已撤销${r.updated ? `，重算了 ${r.updated} 节课` : ''}`, { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  },
};

export function mounted(root) {
  const input = root.querySelector('#student-search');
  input?.addEventListener('input', () => {
    ui.q = input.value;
    root.querySelector('.js-groups').innerHTML = String(groups());
  });
}

/** 课费变化后：刷新基础数据、已加载的周和学员记录 */
async function afterFeeChange(studentId) {
  await loadBase();
  const weeks = [...state.weeks.keys()];
  await Promise.all([
    ...weeks.map((w) => loadWeek(w).catch(() => {})),
    state.studentLessons.has(studentId) ? loadStudentLessons(studentId).catch(() => {}) : null,
  ]);
}

/* ================= 新增 / 编辑 ================= */

export function openStudentForm(id = null) {
  if (!state.orgs.length) {
    toast('请先在「设置」里添加机构');
    location.hash = '#/settings';
    return;
  }
  const s = id ? student(id) : null;
  const st = {
    type: s?.type || 'one',
    name: s?.name || '',
    org_id: s?.org_id || state.orgs[0].id,
    grade_id: s ? s.grade_id : state.grades[0]?.id ?? null,
    fee: '',
    feeTouched: false,
    save_price: false,
    active: s ? s.active : true,
  };
  const autoFill = () => {
    if (s || st.feeTouched) return;
    const p = priceOf(st.org_id, st.grade_id);
    st.fee = p != null ? String(p) : '';
  };
  autoFill();

  const feeHint = () => {
    const o = org(st.org_id);
    const g = grade(st.grade_id);
    if (!g) return html`<div class="fee-hint">还没有选择年级，请手动填写课费。</div>`;
    const p = priceOf(st.org_id, st.grade_id);
    if (p != null) {
      return html`<div class="fee-hint auto">
        <span>${icon('check')} 已按 ${o.name} · ${g.name} 的价目 ${yuan(p)} 自动填入，可以修改</span>
      </div>`;
    }
    return html`<div class="fee-hint">
      <span>${o.name} 的价目表里还没有 ${g.name}，请手动填写课费</span>
      <label class="check">
        <input type="checkbox" class="js-save-price" ${raw(st.save_price ? 'checked' : '')} />
        <span>同时存入机构价目表（${o.name} · ${g.name}）</span>
      </label>
    </div>`;
  };

  const body = () => html`
    <div class="field">
      <div class="field-label">类型</div>
      <div class="seg full" role="group">
        ${Object.entries(TYPE_LABEL).map(
          ([k, label]) => html`<button type="button" class="${st.type === k ? 'is-on' : ''}" data-act="type" data-v="${k}" aria-pressed="${st.type === k}">${label}</button>`,
        )}
      </div>
    </div>
    <label class="field">
      <span class="field-label">${st.type === 'class' ? '班课名称' : '学员姓名'}</span>
      <input class="input js-name" value="${st.name}" maxlength="40" placeholder="${st.type === 'class' ? '例如：高一数学周末班' : '例如：张三'}" autocomplete="off" autofocus />
    </label>
    <div class="field">
      <div class="field-label">机构</div>
      <div class="chips">
        ${state.orgs.map(
          (o) => html`<button type="button" class="chip ${st.org_id === o.id ? 'is-sel' : ''}" data-c="${o.color}" data-act="org" data-id="${o.id}" aria-pressed="${st.org_id === o.id}">
            <i class="dot" style="${raw(st.org_id === o.id ? 'background:#fff' : '')}"></i>${o.name}
          </button>`,
        )}
      </div>
    </div>
    <div class="field">
      <div class="field-label">年级</div>
      <div class="chips">
        ${state.grades.map(
          (g) => html`<button type="button" class="chip ${st.grade_id === g.id ? 'is-sel' : ''}" data-act="grade" data-id="${g.id}" aria-pressed="${st.grade_id === g.id}">${g.name}</button>`,
        )}
        ${state.grades.length ? '' : html`<span class="muted">还没有年级，可以在设置里添加</span>`}
      </div>
    </div>
    ${s
      ? html`<div class="field">
          <div class="field-label">每节课费</div>
          <div class="fee-now" style="margin:0">
            <span>当前 <b class="num">${yuan(feeOn(s))}</b> /节</span>
            <button type="button" class="btn sm" data-act="fee">${icon('tag')}<span>改课费</span></button>
          </div>
        </div>`
      : html`<div class="field">
          <div class="field-label">每节课费 <span class="muted">（必填）</span></div>
          <div class="fee-input">
            <input class="input num js-fee" type="number" inputmode="decimal" min="0" step="1" value="${st.fee}" placeholder="0" />
          </div>
          <div class="js-fee-hint">${feeHint()}</div>
        </div>`}
    <label class="switch-row">
      <span><b>在读</b><small>停课后不会出现在加课列表里，也不会被套用往周复制</small></span>
      <input type="checkbox" class="switch js-active" ${raw(st.active ? 'checked' : '')} />
    </label>
  `;

  const foot = () => html`
    ${s ? html`<button type="button" class="btn ghost danger" data-act="delete">${icon('trash')}<span>删除</span></button>` : ''}
    <span class="grow"></span>
    <button type="button" class="btn" data-close>取消</button>
    <button type="button" class="btn primary" data-act="save">${icon('check')}<span>保存</span></button>
  `;

  const rerender = () => {
    layer.setBody(body());
  };

  const layer = openLayer({
    title: s ? `编辑 ${s.name}` : '新增学员 / 班课',
    body: body(),
    foot: foot(),
    actions: {
      type: (el) => {
        st.type = el.dataset.v;
        rerender();
      },
      org: (el) => {
        st.org_id = Number(el.dataset.id);
        autoFill();
        rerender();
      },
      grade: (el) => {
        st.grade_id = Number(el.dataset.id);
        autoFill();
        rerender();
      },
      fee: () => {
        layer.close();
        openChangeFee(s.id);
      },
      delete: async () => {
        const n = s.lesson_count;
        const ok = await confirmDialog({
          title: `删除 ${s.name}？`,
          message: n
            ? `会同时删除 TA 的 ${n} 节课程记录，月统计也会随之减少。\n如果只是不再上课，建议关闭「在读」改为停课。`
            : '删除后不可恢复。',
          ok: '删除',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/api/students/${s.id}`);
          state.studentLessons.delete(s.id);
          await loadBase();
          await Promise.all([...state.weeks.keys()].map((w) => loadWeek(w).catch(() => {})));
          layer.close();
          if (location.hash.startsWith(`#/students/${s.id}`)) location.hash = '#/students';
          toast(`已删除 ${s.name}`, { type: 'success' });
        } catch (err) {
          toast(err.message, { type: 'error' });
        }
      },
      save: (el) =>
        busy(el, async () => {
          if (!st.name.trim()) {
            toast('请填写名称', { type: 'error' });
            layer.$('.js-name')?.focus();
            return;
          }
          if (!s && (st.fee === '' || Number(st.fee) < 0 || Number.isNaN(Number(st.fee)))) {
            toast('请填写每节课费', { type: 'error' });
            layer.$('.js-fee')?.focus();
            return;
          }
          try {
            const payload = { name: st.name.trim(), type: st.type, org_id: st.org_id, grade_id: st.grade_id, active: st.active };
            if (s) {
              await api.put(`/api/students/${s.id}`, payload);
            } else {
              const missingPrice = st.grade_id && priceOf(st.org_id, st.grade_id) == null;
              await api.post('/api/students', { ...payload, fee: Number(st.fee), save_price: missingPrice && st.save_price });
            }
            await loadBase();
            layer.close();
            toast(s ? '已保存' : `已添加 ${payload.name}`, { type: 'success' });
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        }),
    },
    onMount: (layer) => {
      layer.root.addEventListener('input', (e) => {
        if (e.target.matches('.js-name')) st.name = e.target.value;
        if (e.target.matches('.js-fee')) {
          st.fee = e.target.value;
          st.feeTouched = true;
        }
      });
      layer.root.addEventListener('change', (e) => {
        if (e.target.matches('.js-save-price')) st.save_price = e.target.checked;
        if (e.target.matches('.js-active')) st.active = e.target.checked;
      });
    },
  });
}

/* ================= 升学 ================= */

export function openPromote(id) {
  const s = student(id);
  if (!s) return;
  const cur = grade(s.grade_id);
  const next = nextGrade(s.grade_id);
  const o = org(s.org_id);
  const curFee = feeOn(s);

  if (!next) {
    openLayer({
      kind: 'dialog',
      head: false,
      label: '升学',
      body: html`<div class="dialog-text">
        <h3>${cur ? `${s.name} 已经是最高年级（${cur.name}）` : `${s.name} 还没有设置年级`}</h3>
        <p>${cur ? '如果已经毕业，可以在「编辑」里关闭「在读」。如需更高年级，请先在设置里添加。' : '请先在「编辑」里选择年级。'}</p>
      </div>`,
      foot: html`<button type="button" class="btn primary" data-close>知道了</button>`,
    });
    return;
  }

  const ref = priceOf(s.org_id, next.id);
  const st = { apply: false, date: today() };
  const layer = openLayer({
    title: `升学 · ${s.name}`,
    sub: '只把年级 +1，课费不会自动改变',
    body: html`
      <div class="grade-jump">
        <span class="g">${cur.name}</span>${icon('arrowRight')}<span class="g new">${next.name}</span>
      </div>
      <p class="hint" style="margin:0 0 4px;font-size:14px;color:var(--text-2)">
        升学后课费仍为 <b class="num">${yuan(curFee)}</b>/节。各机构什么时候算升年级、是否涨价，由你自己决定。
      </p>
      ${ref != null
        ? html`<div class="ref-box">
            <span>参考：${o.name} · ${next.name} 的价目是 <b class="num">${yuan(ref)}</b>/节（仅供参考）</span>
            ${ref !== curFee
              ? html`<label class="check">
                  <input type="checkbox" class="js-apply" />
                  <span>同时把课费改为 ${yuan(ref)}，从
                    <input type="date" class="input sm js-date" value="${st.date}" /> 起生效</span>
                </label>`
              : ''}
          </div>`
        : html`<p class="hint">${o.name} 的价目表里没有 ${next.name} 的价格。</p>`}
    `,
    foot: html`<button type="button" class="btn" data-close>取消</button>
      <button type="button" class="btn primary" data-act="ok">${icon('cap')}<span>确认升学</span></button>`,
    actions: {
      ok: (el) =>
        busy(el, async () => {
          try {
            const body = st.apply && ref != null ? { fee: ref, effective_date: st.date } : {};
            const r = await api.post(`/api/students/${s.id}/promote`, body);
            if (st.apply) await afterFeeChange(s.id);
            else await loadBase();
            layer.close();
            toast(`${s.name} 已升到 ${next.name}${st.apply ? `，课费改为 ${yuan(ref)}` : ''}${r.updated ? `（重算 ${r.updated} 节）` : ''}`, {
              type: 'success',
            });
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        }),
    },
    onMount: (layer) => {
      layer.root.addEventListener('change', (e) => {
        if (e.target.matches('.js-apply')) st.apply = e.target.checked;
        if (e.target.matches('.js-date') && e.target.value) st.date = e.target.value;
      });
    },
  });
}

/* ================= 改课费 ================= */

export function openChangeFee(id) {
  const s = student(id);
  if (!s) return;
  const ref = priceOf(s.org_id, s.grade_id);
  const future = futureFees(s);
  const layer = openLayer({
    title: `改课费 · ${s.name}`,
    sub: `${org(s.org_id)?.name ?? ''} · ${grade(s.grade_id)?.name ?? ''}`,
    body: html`
      <div class="fee-now">
        <span>当前课费</span>
        <span><b class="num">${yuan(feeOn(s))}</b> /节</span>
      </div>
      ${future.length
        ? html`<div class="notice muted">${icon('clock')}<span>已有待生效的改价：${future.map((f) => `${monthDay(f.effective_date)}起 ${yuan(f.fee)}`).join('，')}</span></div>`
        : ''}
      <div class="field">
        <div class="field-label">新课费</div>
        <div class="fee-input">
          <input class="input lg num js-fee" type="number" inputmode="decimal" min="0" step="1" placeholder="0" autofocus />
        </div>
        ${ref != null
          ? html`<div style="margin-top:8px">
              <button type="button" class="chip" data-act="use-ref">参考价目 ${yuan(ref)}</button>
            </div>`
          : ''}
      </div>
      <label class="field">
        <span class="field-label">生效日期</span>
        <input class="input js-date" type="date" value="${today()}" />
      </label>
      <p class="hint">生效日期当天及之后已经排好的课，会按新课费重新计算；之前的课保持原来的课费。</p>
    `,
    foot: html`<button type="button" class="btn" data-close>取消</button>
      <button type="button" class="btn primary" data-act="ok">${icon('check')}<span>确认修改</span></button>`,
    actions: {
      'use-ref': () => {
        layer.$('.js-fee').value = ref;
      },
      ok: (el) =>
        busy(el, async () => {
          const val = layer.$('.js-fee').value;
          const date = layer.$('.js-date').value;
          if (val === '' || Number.isNaN(Number(val)) || Number(val) < 0) {
            toast('请填写新课费', { type: 'error' });
            layer.$('.js-fee').focus();
            return;
          }
          if (!date) {
            toast('请选择生效日期', { type: 'error' });
            return;
          }
          try {
            const r = await api.post(`/api/students/${s.id}/fee`, { fee: Number(val), effective_date: date });
            await afterFeeChange(s.id);
            layer.close();
            toast(`${s.name} 从 ${monthDay(date)} 起 ${yuan(val)}/节${r.updated ? `，已重算 ${r.updated} 节课` : ''}`, {
              type: 'success',
              duration: 3400,
            });
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        }),
    },
  });
}
