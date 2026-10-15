// 设置：机构与价目表、年级、时间段模板
import * as api from './api.js';
import { icon } from './icons.js';
import { state, org, loadBase, COLORS, changed } from './store.js';
import { openLayer, confirmDialog, promptDialog, toast, busy } from './ui.js';
import { html, raw, yuan, duration } from './util.js';

export function render() {
  return html`<section class="page narrow">
    <header class="page-head">
      <div>
        <h1>设置</h1>
        <div class="page-sub">基础数据，偶尔改一下就好</div>
      </div>
    </header>
    <div class="settings-grid">
      ${orgSection()} ${gradeSection()} ${slotSection()}
      <div class="card about">
        ${icon('cloud')}
        <div>
          数据保存在云端数据库，手机和电脑打开同一个网址就能同步，切回页面时会自动刷新。<br />
          计费规则：一节课按「每节课费」计 1 节，与时长无关；每节课创建时保存当时的课费。
        </div>
      </div>
    </div>
  </section>`;
}

function orgSection() {
  const count = (id) => state.students.filter((s) => s.org_id === id).length;
  return html`<section class="card sec wide">
    <div class="sec-head">
      <h2>${icon('building')}机构与价目</h2>
      <button type="button" class="btn sm" data-act="new-org">${icon('plus')}<span>新增机构</span></button>
    </div>
    <p class="sec-desc">价目表只是参考：新增学员时按「机构 + 年级」自动带出课费，没带过的年级不用填。修改价目不会影响已有学员和已排的课。</p>
    ${state.orgs.length
      ? state.orgs.map((o) => {
          const prices = state.grades.filter((g) => o.prices[g.id] != null);
          return html`<div class="org-row" data-c="${o.color}" data-act="edit-org" data-id="${o.id}" role="button" tabindex="0">
            <span class="org-swatch"></span>
            <div class="org-main">
              <div class="org-name">${o.name} <span class="muted" style="font-size:13px">· ${count(o.id)} 个学员 / 班课</span></div>
              <div class="price-chips">
                ${prices.length
                  ? prices.map((g) => html`<span class="pchip">${g.name} <b class="num">${yuan(o.prices[g.id])}</b></span>`)
                  : html`<span class="muted" style="font-size:12.5px">还没有填价目</span>`}
              </div>
            </div>
            ${icon('right')}
          </div>`;
        })
      : html`<div class="empty-mini" style="margin-bottom:10px">还没有机构，先添加一个吧</div>`}
  </section>`;
}

function gradeSection() {
  const used = (id) => state.students.filter((s) => s.grade_id === id).length;
  const n = state.grades.length;
  return html`<section class="card sec">
    <div class="sec-head">
      <h2>${icon('layers')}年级</h2>
      <button type="button" class="btn sm" data-act="new-grade">${icon('plus')}<span>添加</span></button>
    </div>
    <p class="sec-desc">从低到高排列，「升学」会升到下一个年级。</p>
    ${state.grades.map(
      (g, i) => html`<div class="plain-row">
        <span class="grade-idx num">${i + 1}</span>
        <span class="row-main">${g.name}${used(g.id) ? html`<small>${used(g.id)} 人</small>` : ''}</span>
        <button type="button" class="icon-btn" data-act="move-grade" data-id="${g.id}" data-d="-1" aria-label="上移" title="上移" ${raw(i === 0 ? 'disabled' : '')}>${icon('up')}</button>
        <button type="button" class="icon-btn" data-act="move-grade" data-id="${g.id}" data-d="1" aria-label="下移" title="下移" ${raw(i === n - 1 ? 'disabled' : '')}>${icon('down')}</button>
        <button type="button" class="icon-btn" data-act="rename-grade" data-id="${g.id}" aria-label="改名" title="改名">${icon('pencil')}</button>
        <button type="button" class="icon-btn danger" data-act="delete-grade" data-id="${g.id}" aria-label="删除" title="删除">${icon('trash')}</button>
      </div>`,
    )}
    ${n ? '' : html`<div class="empty-mini" style="margin-bottom:10px">还没有年级</div>`}
  </section>`;
}

function slotSection() {
  return html`<section class="card sec">
    <div class="sec-head">
      <h2>${icon('clock')}时间段模板</h2>
      <button type="button" class="btn sm" data-act="new-slot">${icon('plus')}<span>添加</span></button>
    </div>
    <p class="sec-desc">加课时默认选当天第一个空着的时段，之后还能用 ▲/▼ 微调，不会改动模板。</p>
    ${state.slots.map(
      (s) => html`<div class="plain-row">
        <span class="row-main num">${s.start} – ${s.end}<small>${duration(s.start, s.end)}</small></span>
        <button type="button" class="icon-btn" data-act="edit-slot" data-id="${s.id}" aria-label="修改" title="修改">${icon('pencil')}</button>
        <button type="button" class="icon-btn danger" data-act="delete-slot" data-id="${s.id}" aria-label="删除" title="删除">${icon('trash')}</button>
      </div>`,
    )}
    ${state.slots.length ? '' : html`<div class="empty-mini" style="margin-bottom:10px">还没有时间段</div>`}
  </section>`;
}

/* ================= 机构 ================= */

function openOrgForm(id = null) {
  const o = id ? org(id) : null;
  const used = new Set(state.orgs.map((x) => x.color));
  const st = {
    color: o?.color || (COLORS.find(([c]) => !used.has(c)) || COLORS[0])[0],
  };

  const preview = (name) => html`<div class="lesson" data-c="${st.color}">
    <div class="l-time num">10:00<span class="l-dash">–</span>12:00</div>
    <div class="l-name"><span class="l-name-text">张三</span></div>
    <div class="l-meta">${name || '机构名称'} · 高一</div>
  </div>`;

  const layer = openLayer({
    title: o ? `编辑 ${o.name}` : '新增机构',
    body: html`
      <label class="field">
        <span class="field-label">机构名称</span>
        <input class="input js-name" value="${o?.name || ''}" maxlength="40" placeholder="例如：A 机构" autocomplete="off" autofocus />
      </label>
      <div class="field">
        <div class="field-label">颜色 <span class="muted">（课表卡片用这个颜色区分机构）</span></div>
        <div class="swatches">
          ${COLORS.map(
            ([c, label]) => html`<button type="button" class="swatch-btn ${st.color === c ? 'is-sel' : ''}" data-c="${c}" data-act="color" data-color="${c}" aria-label="${label}" aria-pressed="${st.color === c}" title="${label}${used.has(c) && c !== o?.color ? '（已有机构在用）' : ''}">
              ${icon('check')}
            </button>`,
          )}
        </div>
        <div class="org-preview js-preview" style="margin-top:12px">${preview(o?.name)}</div>
      </div>
      <div class="field">
        <div class="field-label">年级价目 <span class="muted">（选填，元/节）</span></div>
        <div class="price-grid">
          ${state.grades.map(
            (g) => html`<label class="price-cell">
              <span>${g.name}</span>
              <input class="input num js-price" type="number" inputmode="decimal" min="0" step="1" data-grade="${g.id}" value="${o?.prices[g.id] ?? ''}" placeholder="—" />
            </label>`,
          )}
        </div>
        <p class="hint">只填带过的年级。新增学员时，如果这里有对应年级的价格，会自动填入课费。</p>
      </div>
    `,
    foot: html`
      ${o ? html`<button type="button" class="btn ghost danger" data-act="delete">${icon('trash')}<span>删除</span></button>` : ''}
      <span class="grow"></span>
      <button type="button" class="btn" data-close>取消</button>
      <button type="button" class="btn primary" data-act="save">${icon('check')}<span>保存</span></button>
    `,
    actions: {
      color: (el) => {
        st.color = el.dataset.color;
        layer.$$('.swatch-btn').forEach((b) => {
          const on = b.dataset.color === st.color;
          b.classList.toggle('is-sel', on);
          b.setAttribute('aria-pressed', on);
        });
        layer.$('.js-preview').innerHTML = String(preview(layer.$('.js-name').value.trim()));
      },
      delete: async () => {
        const n = state.students.filter((s) => s.org_id === o.id).length;
        if (n) {
          toast(`这个机构下还有 ${n} 个学员 / 班课，请先删除或改到其他机构`, { type: 'error', duration: 3600 });
          return;
        }
        if (!(await confirmDialog({ title: `删除 ${o.name}？`, message: '机构和它的价目表会一起删除。', ok: '删除', danger: true }))) return;
        try {
          await api.del(`/api/orgs/${o.id}`);
          await loadBase();
          layer.close();
          toast('已删除', { type: 'success' });
        } catch (err) {
          toast(err.message, { type: 'error' });
        }
      },
      save: (el) =>
        busy(el, async () => {
          const name = layer.$('.js-name').value.trim();
          if (!name) {
            toast('请填写机构名称', { type: 'error' });
            layer.$('.js-name').focus();
            return;
          }
          const prices = {};
          for (const input of layer.$$('.js-price')) {
            const v = input.value.trim();
            if (v === '') continue;
            if (Number.isNaN(Number(v)) || Number(v) < 0) {
              toast('价目需要是不小于 0 的数字', { type: 'error' });
              input.focus();
              return;
            }
            prices[input.dataset.grade] = Number(v);
          }
          try {
            if (o) await api.put(`/api/orgs/${o.id}`, { name, color: st.color, prices });
            else await api.post('/api/orgs', { name, color: st.color, prices });
            await loadBase();
            layer.close();
            toast(o ? '已保存' : `已添加 ${name}`, { type: 'success' });
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        }),
    },
    onMount: (layer) => {
      layer.$('.js-name').addEventListener('input', (e) => {
        layer.$('.js-preview').innerHTML = String(preview(e.target.value.trim()));
      });
    },
  });
}

/* ================= 时间段 ================= */

function openSlotForm(id = null) {
  const s = id ? state.slots.find((x) => x.id === id) : null;
  const layer = openLayer({
    kind: 'dialog',
    head: false,
    label: s ? '修改时间段' : '添加时间段',
    body: html`<div class="dialog-text">
      <h3>${s ? '修改时间段' : '添加时间段'}</h3>
      <div class="time-pair" style="margin-top:14px">
        <label class="field" style="margin:0">
          <span class="field-label">开始</span>
          <input class="input js-start" type="time" step="600" value="${s?.start || '08:00'}" />
        </label>
        <span class="dash">–</span>
        <label class="field" style="margin:0">
          <span class="field-label">结束</span>
          <input class="input js-end" type="time" step="600" value="${s?.end || '10:00'}" />
        </label>
      </div>
    </div>`,
    foot: html`<button type="button" class="btn" data-close>取消</button>
      <button type="button" class="btn primary" data-act="save">保存</button>`,
    actions: {
      save: (el) =>
        busy(el, async () => {
          const start = layer.$('.js-start').value;
          const end = layer.$('.js-end').value;
          if (!start || !end || start >= end) {
            toast('结束时间需要晚于开始时间', { type: 'error' });
            return;
          }
          try {
            if (s) await api.put(`/api/slots/${s.id}`, { start, end });
            else await api.post('/api/slots', { start, end });
            await loadBase();
            layer.close();
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        }),
    },
  });
}

/* ================= 操作 ================= */

export const actions = {
  'new-org': () => openOrgForm(),
  'edit-org': (el) => openOrgForm(Number(el.dataset.id)),

  'new-grade': async () => {
    const name = await promptDialog({ title: '添加年级', placeholder: '例如：小学六年级', ok: '添加', maxlength: 20 });
    if (!name) return;
    try {
      await api.post('/api/grades', { name });
      await loadBase();
      toast(`已添加 ${name}，可以用 ▲/▼ 调整顺序`, { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  },
  'rename-grade': async (el) => {
    const g = state.grades.find((x) => x.id === Number(el.dataset.id));
    const name = await promptDialog({ title: '修改年级名称', value: g.name, maxlength: 20 });
    if (!name || name === g.name) return;
    try {
      await api.put(`/api/grades/${g.id}`, { name });
      await loadBase();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  },
  'move-grade': async (el) => {
    const ids = state.grades.map((g) => g.id);
    const i = ids.indexOf(Number(el.dataset.id));
    const j = i + Number(el.dataset.d);
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    // 先在本地调整顺序，界面立即响应
    state.grades = ids.map((id) => state.grades.find((g) => g.id === id));
    changed();
    try {
      await api.post('/api/grades/order', { ids });
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
    await loadBase().catch(() => {});
  },
  'delete-grade': async (el) => {
    const g = state.grades.find((x) => x.id === Number(el.dataset.id));
    const n = state.students.filter((s) => s.grade_id === g.id).length;
    if (n) {
      toast(`还有 ${n} 个学员 / 班课是${g.name}，不能删除`, { type: 'error' });
      return;
    }
    if (!(await confirmDialog({ title: `删除「${g.name}」？`, message: '各机构价目表里这个年级的价格也会一起删除。', ok: '删除', danger: true }))) return;
    try {
      await api.del(`/api/grades/${g.id}`);
      await loadBase();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  },

  'new-slot': () => openSlotForm(),
  'edit-slot': (el) => openSlotForm(Number(el.dataset.id)),
  'delete-slot': async (el) => {
    const s = state.slots.find((x) => x.id === Number(el.dataset.id));
    if (!(await confirmDialog({ title: `删除 ${s.start}–${s.end}？`, message: '只删除模板，不影响已经排好的课。', ok: '删除', danger: true }))) return;
    try {
      await api.del(`/api/slots/${s.id}`);
      await loadBase();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  },
};
