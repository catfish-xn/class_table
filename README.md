# 课表 · 教培老师课表工具

一位老师自用的排课与记课工具：**设置基础数据 → 每天用周课表排课、记录上课内容和讲义 → 月底自动统计课时费**。
手机、电脑打开同一个网址即可使用，数据存在云端（Cloudflare D1），切回页面时会自动同步。

## 功能一览

| 页面 | 能做什么 |
| --- | --- |
| **课表**（首页） | 一周 7 天，每天只显示已排的课（按时间排序）；手机上按天切换，可左右滑动。每天「＋」加课：默认取模板中当天第一个空时段，▲/▼ 每次提前/推后 10 分钟；卡片上「－」确认后删除；同一天时间重叠会标红提示。顶部显示本周节数和课时费。 |
| 课程详情 | 写上课内容（自动保存）、勾选「讲义已发」「需要补发」（勾选补发时会二次确认）、取消/请假（保留记录、划线、不计费）、改日期、查看该学员**上次上课内容**。 |
| 套用往周 | 从上周 / 上上周 / 任意一周复制排课，只复制学员和时间；不复制上课内容、讲义记录、已取消的课和停课学员。本周已有课时可选「只填空格」或「覆盖」。 |
| 补发提醒 | 学员有「需要补发」记录且下一节课在两天之内，课表顶部会提示「张三 明天（周六）的课前记得补发讲义」，点「已补发」即消失。 |
| **学员** | 按机构分组，在读 / 停课筛选、搜索。每个学员可「升学」（只把年级 +1，课费不变，显示新年级参考价）和「改课费」（填新课费和生效日期）。详情页按时间倒序列出每节课的内容和讲义状态。 |
| **统计** | 选月份，按课程日期统计正常的课：总课时费、总节数、已上 / 待上 / 取消，按机构（可展开看学员）和按学员的节数与费用，并与上月对比。 |
| **设置** | 机构（名称、颜色、各年级参考价目）、年级（增删改、排序）、上课时间段模板。 |

界面：圆角卡片，不同机构用不同的柔和颜色区分；深色模式跟随系统；手机优先，常用按钮都足够大；可「添加到主屏幕」像 App 一样使用。

## 计费规则

- 一节课 = 1 节，按「每节课费」计费，与时长无关。
- 每节课创建时按**课程日期**保存当时学员的课费（快照）。修改机构价目表不会影响已有学员和已有课程。
- 改课费时填写生效日期：生效日期及之后**已经排好**的课按新课费重算，之前的课不变；之后再排的课也会按课程日期自动取对应课费（所以提前设置下个月涨价也没问题）。改错了可以在学员详情的「课费记录」里撤销。
- 已取消 / 请假的课不计费，不进统计。

## 项目结构

```
public/                静态前端（原生 JS 模块，无需构建）
  index.html
  styles.css           设计变量、机构配色、深色模式、手机/电脑布局
  js/app.js            入口：路由、导航、全局事件、自动同步
  js/week.js           周课表、加课、课程详情、套用往周
  js/students.js       学员列表/详情、新增编辑、升学、改课费
  js/stats.js          月统计
  js/settings.js       机构价目、年级、时间段
  js/store.js          数据缓存与课程保存（连续修改合并成一次请求）
  js/ui.js / util.js / icons.js / api.js
src/index.js           Cloudflare Worker：/api/* 接口
src/schema.js          D1 表结构（Worker 首次请求时自动建表）
migrations/0001_init.sql  同样的表结构，供 wrangler d1 migrations 使用
test/                  接口测试（node:test + wrangler 本地运行时）
wrangler.jsonc         Worker + 静态资源 + D1 配置
```

运行环境只需要 **Cloudflare Workers（含静态资源）+ D1**，不依赖常驻服务器或其他数据库，也没有外部 CDN 资源（字体用系统字体）。应用内不做登录，访问权限交给部署平台。

## 数据表

| 表 | 说明 |
| --- | --- |
| `orgs` | 机构：`id, name, color, sort` |
| `org_grade_prices` | 机构年级价目（只存填了的年级）：`org_id, grade_id, fee` |
| `grades` | 年级：`id, name, sort`（默认初一～高三） |
| `students` | 学员 / 班课：`id, name, type(one/class), org_id, grade_id, fee, active` |
| `student_fees` | 课费记录：`student_id, effective_date, fee`。新增学员时写入初始课费，每次「改课费」追加一条；排课时按课程日期取适用的课费 |
| `slots` | 时间段模板：`id, start_time, end_time` |
| `lessons` | 课程：`id, date, start_time, end_time, student_id, fee(快照), status(normal/cancelled), content, handout_sent, needs_resend` |

> 和需求里的参考结构相比，多了 `student_fees` 一张表，用来支持「生效日期」：例如今天设置 11 月 1 日起涨价，10 月剩下的课和之后再排的 10 月的课仍按原价，11 月的课按新价。

## 本地开发

需要 Node.js 18+。

```bash
npm install
npm run dev          # http://localhost:8787 ，本地 D1 会在首次请求时自动建表
npm test             # 接口测试
```

## 部署

### ChatGPT Sites / 其他兼容 Cloudflare Workers 的平台

直接使用本仓库：入口是 `src/index.js`，静态资源目录是 `public/`，D1 绑定名为 **`DB`**。
Worker 在第一次收到请求时会自动执行建表语句（全部幂等），所以平台即使不运行 migrations 也能直接用；如果平台支持 D1 migrations，也可以用 `migrations/` 目录。

### 自己部署到 Cloudflare

```bash
npx wrangler login
npx wrangler d1 create class_table            # 把输出的 database_id 填进 wrangler.jsonc
npm run db:migrate:remote                     # 可选：建表（不执行也会自动建表）
npm run deploy
```

部署后建议在 Cloudflare Zero Trust（Access）里给这个网址加上访问限制，只允许自己的邮箱登录。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bootstrap?week=&today=&now=` | 基础数据 +（可选）某周课程 + 补发提醒 |
| POST/PUT/DELETE | `/api/orgs[/:id]` | 机构（含价目表 `prices: {年级id: 课费}`） |
| POST/PUT/DELETE | `/api/grades[/:id]`，POST `/api/grades/order` | 年级与排序 |
| POST/PUT/DELETE | `/api/slots[/:id]` | 时间段模板 |
| POST/PUT/DELETE | `/api/students[/:id]` | 学员 / 班课（新增时 `save_price` 可同时存入价目表） |
| POST | `/api/students/:id/promote` | 升学（年级 +1，可选同时改课费） |
| POST / DELETE | `/api/students/:id/fee[/:feeId]` | 改课费（生效日期起重算）/ 撤销 |
| GET | `/api/students/:id/lessons` | 学员全部课程（倒序） |
| POST | `/api/students/:id/resent` | 清除该学员的「需要补发」 |
| GET / POST | `/api/lessons?from=&to=` / `/api/lessons` | 查询 / 新增课程 |
| PATCH / DELETE | `/api/lessons/:id` | 修改时间、日期、状态、内容、讲义标记 / 删除 |
| GET | `/api/lessons/:id/previous` | 该学员上一次填写过内容的课 |
| POST | `/api/lessons/copy-week` | 套用往周 `{from, to, mode: fill/overwrite}` |
| GET | `/api/reminders?today=&now=` | 补发提醒 |
| GET | `/api/stats?month=YYYY-MM` | 月统计数据 |
