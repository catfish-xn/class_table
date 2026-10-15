// 弹层（底部抽屉 / 对话框）、确认框、输入框、轻提示
import { esc, html } from './util.js';
import { icon } from './icons.js';

const stack = [];

function layerRoot() {
  return document.getElementById('overlays');
}

/**
 * 打开一个弹层。手机上是底部抽屉，电脑上是居中卡片。
 * kind: 'sheet'（默认）| 'dialog'（小确认框，始终居中）
 * actions: { name(el, event, layer) }，作用于弹层内 [data-act]
 */
export function openLayer({
  title = '',
  sub = '',
  body = '',
  foot = '',
  kind = 'sheet',
  size = '',
  actions = {},
  onClose,
  onMount,
  head = true,
  label,
}) {
  const prevFocus = document.activeElement;
  const root = document.createElement('div');
  root.className = `overlay ${kind} ${size}`;
  root.innerHTML = String(html`
    <div class="scrim" data-close></div>
    <div class="panel" role="dialog" aria-modal="true" aria-label="${label || title}" tabindex="-1">
      ${kind === 'sheet' ? html`<div class="grabber" aria-hidden="true"></div>` : ''}
      ${head
        ? html`<header class="panel-head">
            <div class="panel-titles">
              <h2 class="panel-title">${title}</h2>
              <div class="panel-sub">${sub}</div>
            </div>
            <button type="button" class="icon-btn ghost" data-close aria-label="关闭">${icon('x')}</button>
          </header>`
        : ''}
      <div class="panel-body">${body}</div>
      <footer class="panel-foot">${foot}</footer>
    </div>
  `);
  const panel = root.querySelector('.panel');
  const layer = {
    root,
    panel,
    closed: false,
    $: (sel) => root.querySelector(sel),
    $$: (sel) => [...root.querySelectorAll(sel)],
    setBody(h) {
      root.querySelector('.panel-body').innerHTML = String(h);
    },
    setFoot(h) {
      const f = root.querySelector('.panel-foot');
      f.innerHTML = String(h);
      f.hidden = !String(h).trim();
    },
    setTitle(t, s) {
      const tt = root.querySelector('.panel-title');
      if (tt) tt.textContent = t;
      const st = root.querySelector('.panel-sub');
      if (st && s !== undefined) st.textContent = s;
    },
    close(result) {
      if (layer.closed) return;
      if (layer.beforeClose && layer.beforeClose() === false) return;
      layer.closed = true;
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      root.classList.remove('open');
      root.classList.add('closing');
      const done = () => root.remove();
      panel.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 320);
      if (!stack.length) document.documentElement.classList.remove('locked');
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
      onClose?.(result);
    },
  };
  root.querySelector('.panel-foot').hidden = !String(foot).trim();

  root.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer && root.contains(closer)) {
      e.preventDefault();
      layer.close();
      return;
    }
    const el = e.target.closest('[data-act]');
    if (el && root.contains(el) && actions[el.dataset.act]) {
      e.preventDefault();
      if (el.disabled) return;
      actions[el.dataset.act](el, e, layer);
    }
  });

  layerRoot().appendChild(root);
  stack.push(layer);
  document.documentElement.classList.add('locked');
  onMount?.(layer);
  // 下一帧加上 open 触发过渡动画
  requestAnimationFrame(() => {
    root.classList.add('open');
    const auto = root.querySelector('[autofocus]');
    if (auto && matchMedia('(hover: hover)').matches) auto.focus();
    else panel.focus({ preventScroll: true });
  });
  return layer;
}

export const topLayer = () => stack[stack.length - 1] || null;

/** 关闭所有弹层（例如切换页面时） */
export function closeAllLayers() {
  for (const layer of [...stack].reverse()) layer.close();
}
export const hasLayer = () => stack.length > 0;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) {
    e.preventDefault();
    topLayer().close();
  }
});

/* ---------- 确认框 ---------- */

export function confirmDialog({ title, message = '', ok = '确定', cancel = '取消', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openLayer({
      kind: 'dialog',
      head: false,
      label: title,
      body: html`<div class="dialog-text">
        <h3>${title}</h3>
        ${message ? html`<p>${message}</p>` : ''}
      </div>`,
      foot: html`<button type="button" class="btn" data-close>${cancel}</button>
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-act="ok" autofocus>${ok}</button>`,
      actions: {
        ok: (el, e, layer) => {
          answer = true;
          layer.close();
        },
      },
      onClose: () => resolve(answer),
    });
  });
}

/* ---------- 单行输入框 ---------- */

export function promptDialog({ title, label = '', value = '', placeholder = '', ok = '保存', maxlength = 40 }) {
  return new Promise((resolve) => {
    let answer = null;
    const submit = (layer) => {
      const v = layer.$('input').value.trim();
      if (!v) {
        layer.$('input').focus();
        return;
      }
      answer = v;
      layer.close();
    };
    openLayer({
      kind: 'dialog',
      head: false,
      label: title,
      body: html`<form class="dialog-text" data-form>
        <h3>${title}</h3>
        <label class="field">
          ${label ? html`<span class="field-label">${label}</span>` : ''}
          <input class="input" value="${value}" placeholder="${placeholder}" maxlength="${maxlength}" autofocus />
        </label>
      </form>`,
      foot: html`<button type="button" class="btn" data-close>取消</button>
        <button type="button" class="btn primary" data-act="ok">${ok}</button>`,
      actions: { ok: (el, e, layer) => submit(layer) },
      onMount: (layer) => {
        layer.$('form').addEventListener('submit', (e) => {
          e.preventDefault();
          submit(layer);
        });
        // 手机上也直接弹出键盘
        setTimeout(() => layer.$('input').focus(), 60);
      },
      onClose: () => resolve(answer),
    });
  });
}

/* ---------- 轻提示 ---------- */

export function toast(message, { type = 'info', duration = 2600 } = {}) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const ic = type === 'error' ? 'alert' : type === 'success' ? 'check' : 'bell';
  el.innerHTML = `${icon(ic)}<span>${esc(message)}</span>`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/** 按钮进入"处理中"状态，防止重复提交 */
export async function busy(btn, fn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}
