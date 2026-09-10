# API 监控工具（纯前端 · PWA · 多账号）

监测 DeepSeek 大模型 API 的 token 消耗、剩余余额与消费估算。纯 HTML + CSS + JavaScript，无框架、无后端，所有数据只存在本机浏览器。

## 功能

- **顶部总览**：剩余余额（全部账号合计，来自官方接口）+ 消费金额（按设置单价估算）
- **多账号**：可添加多个 DeepSeek API Key，首页下拉随时切换，各自独立统计
- **消耗趋势**：今天（按小时）/ 7 天 / 14 天 / 30 天 四种时间范围切换，原生 Canvas 折线图
- **单账号概览**：本账号余额、已消耗 Token、总配额（充值+赠送）
- **设置页**：账号管理（增删改、API 地址、测试模型）、消费估算单价、自动刷新间隔（1~60 分钟）、余额告警阈值（弹窗 + 系统通知）、密钥本地缓存开关、跨域代理
- **记录页**：每次调用的输入/输出 token 日志，按账号筛选，今日/累计汇总，导出 CSV
- **小组件**：`widget.html` 速览页（账号名/模型、剩余余额、已消耗 Token）
- **演示模式**：无密钥预览全部界面（自动生成 30 天模拟数据）

## 数据来源说明

- **剩余余额**：DeepSeek 官方接口 `GET /user/balance`（已文档化），显示总余额、赠送余额、充值余额
- **消费金额**：DeepSeek 官方未提供消费查询接口，应用按价格表估算：
  `费用 = 缓存命中输入 × 命中价 + 缓存未命中输入 × 未命中价 + 输出 × 输出价`，按每次调用的模型匹配价格表
  - 「测试调用」会记录 DeepSeek 返回的**缓存命中/未命中 token 明细**（`prompt_cache_hit_tokens`）
  - 官方价分高峰/空闲时段（高峰为工作日 9:00-12:00、14:00-18:00，空闲约为高峰一半），设置页默认填**高峰价**（保守估算），可自行修改
  - 当前官方价参考（2026-09，[官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)）：deepseek-flash 高峰 命中 0.04 / 未命中 2 / 输出 8；deepseek-v4-pro 高峰 命中 0.30 / 未命中 9 / 输出 27
- **Token 消耗记录**：来自本应用内发起的「测试调用 / 连接测试」（每次约 20 Token，费用不足一厘钱）；在其它地方调用 API 的用量纯前端无法采集

## 文件结构

```
project1/
├── index.html          主应用（首页 / 记录 / 设置 三页）
├── widget.html         桌面小组件速览页
├── manifest.json       PWA 清单（含“小组件”快捷方式）
├── sw.js               Service Worker 离线缓存
├── css/style.css       浅色主题 · 移动端自适应
├── js/store.js         localStorage 数据层（多账号/记录/快照/估算/CSV）
├── js/providers.js     DeepSeek 官方接口对接
├── js/chart.js         原生 Canvas 折线图（触摸提示）
├── js/app.js           主逻辑（多账号/时间范围/刷新/告警/演示模式）
├── js/widget.js        小组件页逻辑
├── icons/              应用图标（192/512/遮罩/apple-touch/svg）
└── tools/gen_icons.py  图标生成脚本（python tools/gen_icons.py）
```

## 本地运行

Service Worker 要求 `http://localhost` 或 HTTPS，**直接双击 index.html（file://）不可用**。

```bash
cd project1
python -m http.server 8080        # 或: npx serve .
# 打开 http://localhost:8080
```

先在「设置 → 演示模式」打开开关，无需密钥即可体验全部功能。

## 部署到手机（PWA 需要 HTTPS）

任选其一：

- **GitHub Pages**：新建仓库 → 上传本目录全部文件 → Settings → Pages → 选择分支 → 得到 `https://<用户名>.github.io/<仓库名>/`
- **Vercel / Netlify**：拖拽文件夹上传即可得到 https 地址

## 安装到手机桌面 + 小组件（iQOO / OriginOS）

1. 手机浏览器（Chrome / vivo 自带浏览器）打开部署好的 https 地址
2. 菜单 → **添加到主屏幕 / 安装应用**，安装后得到独立窗口的「API监控」应用
3. **小组件两种用法**：
   - 长按桌面上的「API监控」图标 → 出现快捷方式 **「小组件 · 余额速览」** → 点击直达速览页
   - 或在浏览器中打开 `https://…/widget.html` → 菜单 → 添加到主屏幕，得到一张独立的“小组件”卡片图标
4. 说明：Android 的 Chrome 目前不为 PWA 提供真正可摆放的桌面插件（Widget）接口，以上「速览页 + 快捷方式」是 PWA 方案下的标准做法

## 常见问题

- **提示跨域(CORS)失败**：个别浏览器环境会拦截浏览器直连官方接口，在「设置 → 跨域代理前缀」填入任意兼容代理地址即可；电脑 Chrome 直连官方接口已实测可用
- **密钥安全**：密钥只保存在本机浏览器 localStorage，请勿在公用电脑勾选「记住密钥」
- **更新应用**：修改代码后把 `sw.js` 里的 `VERSION` 号 +1，客户端会自动刷新缓存
