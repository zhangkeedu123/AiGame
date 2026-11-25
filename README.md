# 金缮夜馆 · 微信和抖音小游戏 1

两端共用 JavaScript 游戏逻辑、Canvas 2D 画面和六件瓷器素材。每片碎片显示固定序号，可以自由拖放及重叠。相邻裂边的位置和方向对齐时吸附，拼合的碎片可以整组移动。

普通模式共 10 关，从 5 片增加到 50 片，每关多 5 片。困难模式共 20 关，首关 20 片，每关多 2 片，碎片可旋转。极难模式按关卡编号持续生成切片，从 30 片起，单关最多 64 片目标碎片和 12 片来自其他瓷器的干扰碎片。各模式和每日一瓷分别保存进度。

每关有倒计时，退到首页或切到后台时暂停。重排会调整桌面上未完成的碎片和拼组，保留组内已吸附的关系。重开会从本关初始时间重新开始。超时后可重开，也可完整看完激励视频增加 60 秒。

每日一瓷按北京时间零点轮换。排行榜展示本机最快的五个每日成绩，同一天保留最佳用时。小游戏分享由宿主平台调起，浏览器预览可使用系统分享或复制文案。

首页和关卡顶部均可打开「设置」。背景音乐与游戏音效各有独立开关和音量滑块，设置保存在本机。首次触摸后可播放声音，切到后台时暂停；打开关卡设置时，倒计时会暂时停下。

## 1. 先在开发者工具里跑起来

解压 `jinyao-minigames.zip`。压缩包内已有两份生成好的工程，可以直接导入对应目录。

| 平台 | 导入目录 | 操作 |
| --- | --- | --- |
| 微信小游戏 | `dist/wechat/` | 打开微信开发者工具，导入小游戏目录，选择你的微信小游戏 AppID，然后点「编译」。开发者工具如果提供测试号选项，可以用它做本地模拟器调试。 |
| 抖音小游戏 | `dist/douyin/` | 打开抖音开发者工具，在小游戏项目列表中导入或关联该目录，填入抖音小游戏 AppID，然后点「编译」。如果导入需要先设置项目类型，选择「小游戏」。 |

真机扫码预览需要在对应开发者工具里登录有项目权限的账号，并使用对应平台的小游戏 AppID。导入目录的根部能直接看到 `game.js` 和 `game.json`。关卡目录、玩家身份和拼图存档都来自后台接口，包内的 PNG 与六关数据只在后台连不上时作离线兜底，首页会标注「离线兜底」。

[微信开发者工具下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) · [抖音开发者工具下载](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/dev-tools/developer-instrument-update-and-download) · [抖音小游戏新手教程](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/dev-guide/newbie-tutorial)

## 2. 后台环境（dev / master）

前端只有一份源码，靠 `appids.local.json` 决定连哪套后台：

| 环境 | 指向 | 构建命令 |
| --- | --- | --- |
| `dev` | 本机 AiGameApi（`http://127.0.0.1:8000`） | `node scripts/build.js --env dev` 或 `npm run build:dev` |
| `master` | 服务器已发布接口 | `node scripts/build.js --env master` 或 `npm run build:master` |

不带 `--env` 时用 JSON 里的 `env`。构建会把选中的地址写进 `dist/*/platform/online-config.js`，游戏运行时按下面的顺序取数据，全部走 HTTP，本地不再有第二套数据源：

| 数据 | 接口 | 说明 |
| --- | --- | --- |
| 玩家身份 | `POST /api/v1/me/guest` | 设备号换令牌，令牌按环境分开存，换环境不会串号 |
| 关卡目录 | `GET /api/v1/levels` + `GET /api/v1/levels/{id}` | 只取后台已发布、未归档的关卡；每日一瓷、三种模式的关卡都从这份目录派生 |
| 图集 | `GET /api/v1/levels/{id}/atlas.png` | 碎片贴图直接用后台图集，换图不用重新发版 |
| 进度存档 | `GET/PUT /api/v1/me/progress/{level_id}` | 带 `revision` 乐观锁，409 自动重读再写；跨设备可续玩 |

浏览器预览也读同一份 JSON 的 `env`，页面里**不提供环境切换**：改 `appids.local.json` 的 `"env"` 为 `dev` 或 `master`，重启预览（或重新构建）即可。需要临时切一次而不改文件时，可以用 `node scripts/preview.js --env dev`。

## 2. 用 VS Code 里的 Codex 开发

1. 安装 Node.js 18 或更高版本。用 VS Code 打开包含 `AGENTS.md`、`package.json` 和 `src/` 的 **`jinyao-minigames` 根目录**。
2. 打开 Codex 扩展并登录。扩展会读取根目录的 `AGENTS.md`，其中写有玩法约束、源码入口和验收命令。如果使用 Codex CLI，也可以在工程根目录执行 `codex`。
3. 把功能和验收条件一起交给 Codex。让它修改 `src/`，运行构建和本地检查，再去两个平台的开发者工具里分别编译。

示例任务可以直接粘贴到 Codex。

> 读取 AGENTS.md 和 README.md。把第一关的吸附距离改为 18，保持其余关卡不变。错片仍可重叠并停在原处，正确相邻的碎片拼好后仍可整组拖动。修改共享源码，执行 node scripts/build.js 和 node scripts/check.js，告诉我改了哪些文件、怎样在微信和抖音模拟器验收。

本地命令都从根目录运行，无需执行 npm install。

```powershell
node scripts/build.js --env master   # 或 npm run build:master，出线上包
node scripts/build.js --env dev      # 或 npm run build:dev，连本机后端
node scripts/check.js
```

只生成一端时使用 `node scripts/build.js wechat` 或 `node scripts/build.js douyin`（可同时带 `--env`）。若使用 IDE 编辑了输出目录的 `project.config.json`，构建脚本会保留已有 AppID。也可以复制 `appids.example.json` 为 `appids.local.json` 并填入两端各自的 AppID 与两套后台地址，之后构建会优先使用它。

激励视频使用各平台官网分配的广告位。在 `appids.local.json` 的 `rewardedAds.wechat` 和 `rewardedAds.douyin` 填入对应广告位 ID 后重新构建。浏览器预览或未配置广告位的包会显示暂不可用提示，仍可重开。

[Codex 的 VS Code 扩展](https://developers.openai.com/codex/ide/) · [AGENTS.md 指南](https://developers.openai.com/codex/guides/agents-md)

## 3. 改功能时去哪里

| 想改的内容 | 文件 |
| --- | --- |
| 名称、难度、文案、旋转设置、吸附距离 | `src/core/levels.js` |
| 三种闯关模式的数量、切片、干扰片和初始时间 | `src/core/modes.js` |
| 碎片叠放、吸附、整组移动、旋转和解锁规则 | `src/core/puzzle.js` |
| 竖屏布局、按钮、桌面颜色和藏品柜 | `src/core/view.js` |
| 游戏流程、触摸会话、存档时机 | `src/main.js` |
| Canvas、触摸事件、素材加载和本地存储适配 | `src/platform/mini-game.js` |
| 六套 PNG 图集、碎片多边形、裂边和描金点 | `src/assets/` 与 `src/core/geometry.js` |
| 两端入口及 IDE 配置模板 | `platforms/wechat/` 与 `platforms/douyin/` |

`dist/` 是生成目录。提交代码时保留共享源码、构建脚本、平台模板和文档。新瓷器需要同步追加游戏配置、图集裁剪矩形、碎片轮廓和相邻裂边，先用本地检查验证裂边能连成一件完整瓷器。

内置字体包含当前界面的文字，系统字体作为后备。如需把新文案加入内置字体，可使用 Python 与 fontTools，运行 `python scripts/subset-font.py <NotoSansCJKsc-Regular.otf 的路径>` 后重新构建。字体授权说明在 `src/assets/jinyao-ui-OFL.txt`。

## 4. 验收

本地检查会跑两份实际生成的 `game.js`，用模拟平台 API 验证竖屏配置、图片路径、碎片序号、错片叠放、相邻吸附、整组拖动、触摸取消、拼齐通关和存档。同时检查六关的裂边能连成完整瓷器。

在微信和抖音模拟器各点一次「编译」后，检查模式首页、普通模式的首关 5 片和第二关 10 片、困难模式的旋转及极难模式的干扰片。部分拼合后点「重排」，确认已拼组保持合并，倒计时继续。等倒计时归零，检查「本关重开」。在已配置广告位的真机上分别测试跳过广告和完整观看，确认只有完整观看才增加 60 秒。

这份工程在交付环境中完成了本地构建和模拟接口检查。微信、抖音官方 IDE 和真机运行需要用各自平台的开发者账号验证。原网页、微信、抖音使用各自的存档，首次打开小游戏会从第一关开始。
# AiGame
