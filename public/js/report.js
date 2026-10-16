// 月度上课统计图片：按机构列出每个学员的节数、课费、上课日期，以及机构合计。
// 用 Canvas 直接绘制，不依赖外部库；导出 PNG，可保存或分享。
import { icon } from './icons.js';
import { state, org, grade, student, TYPE_LABEL } from './store.js';
import { openLayer, toast } from './ui.js';
import { html, raw, today, nowTime, parseDate, monthLabel, yuan, WEEKDAYS } from './util.js';

/* 与 styles.css 中浅色模式的机构颜色一致 */
const COLOR_HEX = {
  blue: ['#4b7bf0', '#edf2fe', '#2852c0'],
  teal: ['#14a296', '#e3f5f2', '#0a6c63'],
  green: ['#3aa55a', '#e8f6ec', '#22723a'],
  amber: ['#e2a11b', '#fdf4dd', '#875c00'],
  orange: ['#ee7e3d', '#fef0e6', '#a84a14'],
  rose: ['#e35b6a', '#fdedef', '#ad3040'],
  pink: ['#d55fb2', '#fbedf7', '#9c317b'],
  violet: ['#8a66ea', '#f2eefe', '#5b3cbd'],
  cyan: ['#1f9ed6', '#e4f4fb', '#0b6891'],
  indigo: ['#5a68e2', '#eef0fd', '#3742b0'],
  brown: ['#a87751', '#f7f0e9', '#744d2f'],
  slate: ['#6c7789', '#eff1f4', '#444e60'],
};
const ACCENT = ['#3e6bf2', '#ecf1ff', '#2449bd'];
const hexOf = (color) => COLOR_HEX[color] || ACCENT;

const INK = '#171b24';
const TEXT2 = '#565e6e';
const GREY = '#8e95a2';
const LINE = '#eceef2';
const FAMILY =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Segoe UI', Roboto, sans-serif";

/* ================= 数据 ================= */

const byDateTime = (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start);
const zh = new Intl.Collator('zh-CN');

/** 机构 id 为 null 表示全部机构 */
export function buildReport(month, lessons, orgId = null) {
  const sections = [];
  for (const o of state.orgs) {
    if (orgId != null && o.id !== orgId) continue;
    const mine = lessons.filter((l) => student(l.student_id)?.org_id === o.id);
    const normal = mine.filter((l) => l.status === 'normal');
    if (!mine.length && orgId == null) continue;
    const byStudent = new Map();
    for (const l of normal) {
      if (!byStudent.has(l.student_id)) byStudent.set(l.student_id, []);
      byStudent.get(l.student_id).push(l);
    }
    const rows = [...byStudent.entries()]
      .map(([id, ls]) => {
        ls.sort(byDateTime);
        const rates = new Map();
        for (const l of ls) rates.set(l.fee, (rates.get(l.fee) || 0) + 1);
        return { student: student(id), lessons: ls, count: ls.length, fee: ls.reduce((s, l) => s + l.fee, 0), rates };
      })
      .sort((a, b) => zh.compare(a.student.name, b.student.name));
    sections.push({
      org: o,
      rows,
      count: normal.length,
      fee: rows.reduce((s, r) => s + r.fee, 0),
      cancelled: mine.length - normal.length,
    });
  }
  return {
    month,
    org: orgId == null ? null : org(orgId),
    sections,
    count: sections.reduce((s, x) => s + x.count, 0),
    fee: sections.reduce((s, x) => s + x.fee, 0),
    students: sections.reduce((s, x) => s + x.rows.length, 0),
    cancelled: sections.reduce((s, x) => s + x.cancelled, 0),
  };
}

const rateText = (rates) =>
  rates.size === 1
    ? `${yuan([...rates.keys()][0])}/节`
    : [...rates.entries()].map(([fee, n]) => `${yuan(fee)} × ${n} 节`).join('   ');

const lessonChip = (l) => `${parseDate(l.date).getDate()}日 ${WEEKDAYS[(parseDate(l.date).getDay() + 6) % 7]} ${l.start}`;

/* ================= 绘制 ================= */

const font = (size, weight = 400) => `${weight} ${size}px ${FAMILY}`;

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** 先排版（记录绘制步骤、算出总高度），再按实际高度创建画布绘制 */
export function drawReport(R, { showDates = true, scale = 2 } = {}) {
  const W = 750;
  const M = 24; // 卡片外边距
  const PAD = 36; // 卡片内边距
  const X0 = M + PAD;
  const X1 = W - M - PAD;
  const CW = X1 - X0;
  const COUNT_X = X1 - 150; // 节数列右边缘
  const [c1, soft, ink] = hexOf(R.org?.color);

  const measurer = document.createElement('canvas').getContext('2d');
  const measure = (str, size, weight) => {
    measurer.font = font(size, weight);
    return measurer.measureText(str).width;
  };
  const fit = (str, size, weight, max) => {
    if (measure(str, size, weight) <= max) return str;
    const chars = Array.from(str);
    while (chars.length && measure(`${chars.join('')}…`, size, weight) > max) chars.pop();
    return `${chars.join('')}…`;
  };

  const ops = [];
  const text = (str, x, y, size, weight, color, align = 'left') =>
    ops.push((c) => {
      c.font = font(size, weight);
      c.fillStyle = color;
      c.textAlign = align;
      c.fillText(str, x, y);
    });
  const box = (x, y, w, h, r, fill) =>
    ops.push((c) => {
      roundRect(c, x, y, w, h, r);
      c.fillStyle = fill;
      c.fill();
    });
  const hline = (y, color = LINE) => box(X0, y, CW, 1, 0, color);

  let y = M + PAD;

  // 顶部：标识 + 月份
  const ly = y;
  ops.push((c) => {
    const y = ly;
    const g = c.createLinearGradient(X0, y, X0 + 30, y + 30);
    g.addColorStop(0, '#6a8fff');
    g.addColorStop(1, '#3157d6');
    roundRect(c, X0, y, 30, 30, 9);
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    roundRect(c, X0 + 7.5, y + 9, 15, 13.5, 3);
    c.stroke();
    c.beginPath();
    c.moveTo(X0 + 7.5, y + 13.5);
    c.lineTo(X0 + 22.5, y + 13.5);
    c.moveTo(X0 + 11.5, y + 6.5);
    c.lineTo(X0 + 11.5, y + 10);
    c.moveTo(X0 + 18.5, y + 6.5);
    c.lineTo(X0 + 18.5, y + 10);
    c.stroke();
  });
  text('月度上课统计', X0 + 42, y + 21, 17, 600, TEXT2);
  text(monthLabel(R.month), X1, y + 21, 17, 600, TEXT2, 'right');
  y += 30 + 30;

  // 标题
  const title = R.org ? R.org.name : '全部机构';
  box(X0, y + 2, 6, 38, 3, c1);
  text(fit(title, 34, 800, CW - 20), X0 + 20, y + 34, 34, 800, INK);
  y += 40 + 12;
  const [yy, mm] = R.month.split('-').map(Number);
  const lastDay = new Date(yy, mm, 0).getDate();
  text(`${yy}年${mm}月1日 – ${mm}月${lastDay}日 · 只统计正常上课的课程`, X0 + 20, y + 16, 16, 400, GREY);
  y += 16 + 28;

  // 汇总
  const boxH = 120;
  box(X0, y, CW, boxH, 22, soft);
  const colW = CW / 3;
  [
    ['课时费合计', yuan(R.fee), ink],
    ['上课节数', `${R.count} 节`, INK],
    [R.org ? '学员 / 班课' : '机构', R.org ? `${R.students} 个` : `${R.sections.filter((s) => s.count).length} 个`, INK],
  ].forEach(([label, value, color], i) => {
    const x = X0 + 24 + colW * i;
    text(label, x, y + 40, 15, 600, i === 0 ? ink : TEXT2);
    text(value, x, y + 88, i === 0 ? 36 : 30, 800, color);
  });
  y += boxH + 30;

  const multi = R.sections.length > 1 || !R.org;

  for (const sec of R.sections) {
    const [sc, ssoft, sink] = hexOf(sec.org.color);
    if (multi) {
      box(X0, y + 4, 12, 12, 6, sc);
      text(fit(sec.org.name, 22, 750, CW - 260), X0 + 22, y + 18, 22, 750, INK);
      text(`${sec.count} 节 · ${yuan(sec.fee)}`, X1, y + 18, 20, 750, sink, 'right');
      y += 18 + 18;
    }
    // 表头
    text('学员 / 班课', X0, y + 14, 14, 600, GREY);
    text('节数', COUNT_X, y + 14, 14, 600, GREY, 'right');
    text('课时费', X1, y + 14, 14, 600, GREY, 'right');
    y += 14 + 12;
    hline(y);

    if (!sec.rows.length) {
      y += 18;
      text('这个月没有正常上课的课程', X0, y + 18, 16, 400, GREY);
      y += 18 + 18;
    }

    sec.rows.forEach((r, i) => {
      y += 20;
      const s = r.student;
      const meta = [grade(s.grade_id)?.name, TYPE_LABEL[s.type]].filter(Boolean).join(' · ');
      const nameMax = COUNT_X - 70 - X0;
      const name = fit(s.name, 22, 700, nameMax);
      const nameW = measure(name, 22, 700);
      text(name, X0, y + 22, 22, 700, INK);
      if (meta && nameW + 14 + measure(meta, 15, 400) <= nameMax) text(meta, X0 + nameW + 12, y + 21, 15, 400, GREY);
      text(`${r.count} 节`, COUNT_X, y + 22, 20, 600, INK, 'right');
      text(yuan(r.fee), X1, y + 22, 22, 750, INK, 'right');
      y += 22 + 10;
      text(fit(rateText(r.rates), 15, 400, CW), X0, y + 15, 15, 400, TEXT2);
      y += 15;

      if (showDates) {
        y += 12;
        const CH = 30;
        const GAP = 8;
        let x = X0;
        for (const l of r.lessons) {
          const label = lessonChip(l);
          const w = measure(label, 14.5, 500) + 22;
          if (x + w > X1 + 0.5) {
            x = X0;
            y += CH + GAP;
          }
          const cx = x;
          const cy = y;
          box(cx, cy, w, CH, 9, ssoft);
          text(label, cx + 11, cy + 20, 14.5, 500, sink);
          x += w + GAP;
        }
        y += CH;
      }
      y += 20;
      if (i < sec.rows.length - 1) hline(y);
    });

    if (sec.cancelled) {
      y += 6;
      text(`另有 ${sec.cancelled} 节取消 / 请假，未计费`, X0, y + 14, 14, 400, GREY);
      y += 14 + 4;
    }
    y += multi ? 30 : 8;
  }

  // 合计
  hline(y, '#dfe2e8');
  y += 26;
  text('合计', X0, y + 26, 22, 750, INK);
  text(`${R.count} 节`, COUNT_X, y + 26, 20, 650, INK, 'right');
  text(yuan(R.fee), X1, y + 28, 32, 800, ink, 'right');
  y += 32 + 26;

  const cardBottom = y + PAD - 10;
  const H = cardBottom + M + 34;
  text(`导出于 ${today()} ${nowTime()} · 课表`, W / 2, cardBottom + 26, 13, 400, '#a3a9b5', 'center');

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const c = canvas.getContext('2d');
  c.scale(scale, scale);
  // 背景与卡片
  const bg = c.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, soft);
  bg.addColorStop(1, '#f4f5f8');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  c.save();
  c.shadowColor = 'rgba(16, 24, 40, 0.10)';
  c.shadowBlur = 30;
  c.shadowOffsetY = 8;
  roundRect(c, M, M, W - M * 2, cardBottom - M, 28);
  c.fillStyle = '#fff';
  c.fill();
  c.restore();
  c.textBaseline = 'alphabetic';
  for (const op of ops) op(c);
  return canvas;
}

/* ================= 导出面板 ================= */

const canShareFiles = () => {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
};

export function openExport({ month, lessons, orgId = null }) {
  const orgIds = new Set(lessons.map((l) => student(l.student_id)?.org_id).filter(Boolean));
  const orgs = state.orgs.filter((o) => orgIds.has(o.id));
  const st = {
    orgId: orgId ?? (orgs.length === 1 ? orgs[0].id : null),
    dates: true,
    blob: null,
  };
  const fileName = () => `${monthLabel(month)}-${st.orgId == null ? '全部机构' : org(st.orgId)?.name}-上课统计.png`;

  const body = () => html`
    <div class="field">
      <div class="field-label">机构</div>
      <div class="chips">
        <button type="button" class="chip ${st.orgId == null ? 'is-sel' : ''}" data-act="org" data-id="">全部机构</button>
        ${orgs.map(
          (o) => html`<button type="button" class="chip ${st.orgId === o.id ? 'is-sel' : ''}" data-c="${o.color}" data-act="org" data-id="${o.id}">
            <i class="dot" style="${raw(st.orgId === o.id ? 'background:#fff' : '')}"></i>${o.name}
          </button>`,
        )}
      </div>
    </div>
    <label class="switch-row" style="margin-bottom:16px">
      <span><b>列出每节课的日期和时间</b><small>方便和机构核对</small></span>
      <input type="checkbox" class="switch js-dates" ${raw(st.dates ? 'checked' : '')} />
    </label>
    <div class="export-preview js-preview"><div class="skeleton" style="height:320px;margin:0"></div></div>
    <p class="hint">手机上也可以长按图片直接保存或转发。</p>
  `;

  const foot = () => html`
    ${canShareFiles() ? html`<button type="button" class="btn" data-act="share">${icon('share')}<span>分享</span></button>` : ''}
    <span class="grow"></span>
    <button type="button" class="btn primary" data-act="save">${icon('download')}<span>保存图片</span></button>
  `;

  const generate = () => {
    const R = buildReport(month, lessons, st.orgId);
    const canvas = drawReport(R, { showDates: st.dates, scale: 2 });
    const preview = layer.$('.js-preview');
    preview.innerHTML = '';
    const img = new Image();
    img.alt = `${monthLabel(month)} 上课统计`;
    img.src = canvas.toDataURL('image/png');
    preview.appendChild(img);
    st.blob = null;
    canvas.toBlob((b) => {
      st.blob = b;
    }, 'image/png');
  };

  const getBlob = () =>
    new Promise((resolve) => {
      if (st.blob) return resolve(st.blob);
      const R = buildReport(month, lessons, st.orgId);
      drawReport(R, { showDates: st.dates, scale: 2 }).toBlob(resolve, 'image/png');
    });

  const layer = openLayer({
    title: '导出统计图片',
    sub: `${monthLabel(month)} · 每个学员的节数、课时费和机构合计`,
    size: 'wide',
    body: body(),
    foot: foot(),
    actions: {
      org: (el) => {
        st.orgId = el.dataset.id ? Number(el.dataset.id) : null;
        layer.setBody(body());
        generate();
      },
      save: async () => {
        const blob = await getBlob();
        if (!blob) return toast('生成图片失败，请重试', { type: 'error' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName();
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 1500);
        toast('图片已保存', { type: 'success' });
      },
      share: async () => {
        const blob = await getBlob();
        if (!blob) return;
        try {
          await navigator.share({ files: [new File([blob], fileName(), { type: 'image/png' })], title: fileName() });
        } catch (err) {
          if (err?.name !== 'AbortError') toast('分享失败，可以改用保存图片', { type: 'error' });
        }
      },
    },
    onMount: (layer) => {
      layer.root.addEventListener('change', (e) => {
        if (e.target.matches('.js-dates')) {
          st.dates = e.target.checked;
          generate();
        }
      });
    },
  });
  // 等弹层出现后再生成，避免卡住动画
  requestAnimationFrame(() => setTimeout(generate, 30));
}
