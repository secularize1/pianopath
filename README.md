# PianoPath

> 每周 4 小时的钢琴学习工作台：每日一课、逐分钟练习、国内教学资源、学习路径、打卡记录和轻量音乐游戏。

[![HTML](https://img.shields.io/badge/HTML-5-e34f26?logo=html5&logoColor=white)](https://developer.mozilla.org/zh-CN/docs/Web/HTML)
[![CSS](https://img.shields.io/badge/CSS-3-1572b6?logo=css3&logoColor=white)](https://developer.mozilla.org/zh-CN/docs/Web/CSS)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2020-f7df1e?logo=javascript&logoColor=111)](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript)
[![Python](https://img.shields.io/badge/Python-3.10+-3776ab?logo=python&logoColor=white)](https://www.python.org/)

## 产品概览

- **学习路径**：12 周、48 次、每次 60 分钟；每课拆成 7 段逐分钟任务。
- **长期路线**：0–3 个月、3–12 个月、1–3 年、3–6 年、6–8 年。
- **国内优先**：默认只显示 B 站公开课与官方教材/考纲；YouTube 资源仅在“全部来源”中出现。
- **交互练习**：音名找键小游戏、节奏热身、逐段计时、音频节拍、暂停、完成打卡。
- **学习反馈**：连续天数、XP、课次完成率、热力图、六周柱状图、历史笔记。
- **个性化**：按每周总时长和练习天数自动重排单次任务。
- **PWA**：可安装到桌面、离线打开，带 Service Worker 缓存。
- **主题**：亮色与深色模式。

### 1.3 学习闭环

- 首次进入提供三步目标设置，创建后直接进入第一课。
- 课程按顺序解锁；完成一课自动进入下一课，不再跳回内容列表。
- 支持中途退出与刷新恢复上次步骤、剩余时间。
- 进度体系：XP、等级、每日三项任务。
- 小游戏升级为“看音名找键”与“听声音辨音”双模式，支持重听、连击与最佳成绩。
- 练习页增加可选节拍器（60/72/84/96 BPM）。
- 计划可重新选择目标、恢复默认或清除全部本地数据。

### 1.2 首页重构

- 单一“开始今日练习”主行动，减少并列入口。
- 首页直接显示本周四次练习与 12 周阶段轨迹。
- 新增音名找键小游戏，带连击、得分和最佳成绩。
- 字体改用本机常用中文字体优先，不加载远程字体。
- 移除来源筛选门槛说明、核验日期和无关资料标签。


## 快速开始

### 本地静态版

```bash
python -m http.server 8787
```

浏览器访问 `http://127.0.0.1:8787`。

Windows 双击 `启动PianoPath.cmd` 也会启动后端模式。

### 后端模式

```bash
python server.py
```

服务器默认监听 `http://127.0.0.1:8787`，数据写入 `data/state.json`。**无需安装第三方依赖。**

### 直接离线

`琴阶PianoPath.html` 为单文件版本，双击即可使用；进度保存在浏览器 `localStorage`。

## 个性化 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务状态 |
| GET | `/api/plan/default` | 默认计划 |
| POST | `/api/plan` | 根据每周时长/天数/阶段/风格生成计划 |
| GET / POST | `/api/state` | 读取/保存学习状态 |
| GET | `/api/curriculum` | 完整课程与资源数据 |

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/plan \
  -H "Content-Type: application/json" \
  -d '{"daysPerWeek":4,"sessionMinutes":60,"level":"zero","style":"classical","goal":"半年内完整弹一首小奏鸣曲"}'
```

## 资源策略

默认资源只包含国内可访问或官方来源。B 站创作者要求 **≥ 25 万粉丝**；官方机构、出版社与方法资料不受粉丝门槛限制。粉丝量只是准入门槛，仍需检查教师资历、课程结构和练习目标。

当前主路径没有任何 YouTube 依赖。资源核验记录见 [`资源核验.md`](./资源核验.md)。

## 项目结构

```text
PianoPath/
├── index.html
├── styles.css
├── app.js
├── data.js
├── server.py
├── sw.js
├── manifest.webmanifest
├── assets/
│   ├── hero-piano.jpg
│   ├── icon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   └── covers/
└── data/state.json
```

## 部署

### GitHub Pages

上传至公共仓库后：

1. 打开仓库 **Settings → Pages**。
2. Source 选择 **Deploy from a branch**。
3. Branch 选择 `main` / root。
4. 保存后访问 `https://<username>.github.io/<repo>/`。

GitHub Pages 无后端，应用会使用浏览器本地存储；前端功能完整可用。

### 任意静态托管

将以下文件上传到网站根目录即可：`index.html`、`styles.css`、`app.js`、`data.js`、`sw.js`、`manifest.webmanifest`、`assets/`。

## 素材说明

封面图来自原平台公开页面或本地制作的品牌封面，仅用于资源导航。应用不包含受版权保护的曲谱；教材与考纲通过官方链接跳转。

## License

MIT
