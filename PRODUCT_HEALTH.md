# PianoPath 1.41.1 — 产品健康检查

| 维度 | 当前状态 | 证据 |
|---|---|---|
| 课程完整度 | 12 周 / 48 次 / 336 步 / 每次 60 分钟；另有 5 个长期阶段训练 | `tests/content-audit.js` / Playwright |
| 国内资源 | 48 节课均有国内或官方来源，主路径无 YouTube | `tests/content-audit.js` |
| 电脑键盘 | 白键 `Z–/` 后接 `N1–N6`，黑键 `A S · F G H · K L · ; ' Enter`；屏幕黑键 2/3 几何逐一验证，物理键码、移调与节奏命中有回归 | `tests/e2e-smoke.js` |
| 首次引导 | 三步选择；首次自由弹进入引导式键位教程；首页单一主入口可恢复中断练习 | Playwright |
| 掌握门槛 | 2/3 通过才完成课程并解锁下一课；题目随当前环节变化；答错显示纠正点，可只重练错题，错题能力进入档案 | Playwright / `tests/e2e-smoke.js` |
| 音乐练习 | 12 首短曲（8 首公共领域 + 4 首流行练习片段）；触屏 + 两排电脑辅助键位；自由弹 C1–D7；40–208 BPM 节拍器；Salamander Grand Piano V3（Yamaha C5，A0–C8，30 个音区 × 5 个力度层）与力度感知合成兜底 | Playwright / `tests/audio-smoke.js` |
| 学习反馈 | 今日主课/掌握路径、每日目标完成反馈、四项能力与错题弱项、本周/上周分钟对比、出勤与薄弱项行动、热力图、首页直达间隔复习、错题焦点进入复习会话、跟弹与自由弹历史；刷新后保留中断练习 | Playwright / app state |
| 录音复盘 | 60 秒课内录音、按练习类型生成任务说明、本机 IndexedDB、声音体检、两遍对比、回放/下载/删除；权限拒绝与单文件降级；音频不上传，跨设备只显示“原设备录音” | `tests/recording-smoke.js` |
| 账户系统 | 注册、登录、同步、退出、删除账户与云端进度 | API / UI integration |
| 跨设备同步 | SQLite + revision 冲突检测 | API integration |
| 离线能力 | 断网刷新仍可进入课程；150 个钢琴采样进入 PWA 离线包；单文件离线包可用 | `tests/offline-smoke.js` / standalone build |
| 响应式 | 桌面 / 手机 / 横屏平板无横向溢出 | Playwright |
| 无障碍 | Keyboard modal regression, DOM audit, named controls | Playwright / `tests/dom-audit.js` |
| 安全性 | PBKDF2、HttpOnly Cookie、私有 DB、CSP | `server.py` |
| 危险操作 | 应用内确认、焦点锁定、Esc/取消与持久化清除验证 | Playwright |
| 隐私与条款 | 独立法律页面、注册强制同意、版本与时间记录、单文件离线说明 | DOM / API / Playwright |
| 练习排期 | 可选 7 个练习日；首页按真实星期/日期推进；API 计划生成、旧备份兼容与手机触控尺寸均有覆盖 | Playwright / API / import |
| 日程提醒 | 设定开始时间；生成 12 周 48 个 ICS 日历事件；支持系统日历导入 | Playwright / API / download |
| 线上部署 | GitHub Pages 自动构建与部署 | GitHub Actions |

## 仍需商业级建设

- 正式云端 API 部署、正式域名、监控与备份策略
- 支付/订阅、退款流程、隐私政策与服务条款
- 教师/家长控制台、真人批改和内容审核工作流
- 更大曲库、版权授权与专业钢琴教师审校
- 产品分析、崩溃监控、A/B 测试与留存实验
- 无障碍专项审计与多浏览器/真机矩阵
