# 金缮夜馆 · 微信和抖音小游戏 1

两端共用 JavaScript 游戏逻辑和 Canvas 2D 画面。每片碎片显示固定序号，可以自由拖放及重叠。相邻裂边的位置和方向对齐时吸附，拼合的碎片可以整组移动。

普通、困难和极难三种模式读取后台各自分类的已上架关卡，按编号从小到大。瓷器、真实碎片、初始旋转数量和同源干扰片由后台生成。游玩当前关时会异步加载下一关配置和图集。

每关从 00:00 开始记录实际游玩时间，退到首页或切到后台时暂停。重排调整桌上的位置，保留已拼合关系和旋转方向。重开重新计时。

每日一瓷按北京时间零点轮换，挑战从后台已上架的「每日一瓷」分类获取，完成后收藏。每集齐 30 件可兑换实物瓷碗等瓷器。闯关月榜先比最高通关编号，再比该关用时。每月总榜冠军另领一件实物瓷器，获奖后在藏品阁提交收货信息。

首页的齿轮提供背景音乐和游戏音效开关及音量设置，设置保存在本机。

## 1. 先在开发者工具里跑起来

解压 `jinyao-minigames.zip`。压缩包内已有两份生成好的工程，可以直接导入对应目录。

| 平台 | 导入目录 | 操作 |
| --- | --- | --- |
| 微信小游戏 | `dist/wechat/` | 打开微信开发者工具，导入小游戏目录，选择你的微信小游戏 AppID，然后点「编译」。开发者工具如果提供测试号选项，可以用它做本地模拟器调试。 |
| 抖音小游戏 | `dist/douyin/` | 打开抖音开发者工具，在小游戏项目列表中导入或关联该目录，填入抖音小游戏 AppID，然后点「编译」。如果导入需要先设置项目类型，选择「小游戏」。 |

真机扫码预览需要在对应开发者工具里登录有项目权限的账号，并使用对应平台的小游戏 AppID。试玩前，在后端执行数据库升级，在管理后台上架至少一关，并为真机构建配置可访问的 HTTPS API 地址。

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
| 关卡目录 | `GET /api/v1/levels` + `GET /api/v1/levels/{id}` | 首页读取编号和分类，进关时加载详情，游玩期间预取下一关 |
| 图集 | `GET /api/v1/levels/{id}/atlas.png?v={版本}` | 使用与关卡配置匹配的图集版本 |
| 闯关 | `GET /api/v1/me/campaign` | 通关和月榜成绩保存在后台，桌面布局保存在设备 |
| 每日与奖励 | `/api/v1/me/daily`、`/api/v1/me/collection`、`GET /api/v1/ranking` | 每日一瓷、收藏、实物领取和闯关月榜 |

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

[Codex 的 VS Code 扩展](https://developers.openai.com/codex/ide/) · [AGENTS.md 指南](https://developers.openai.com/codex/guides/agents-md)

## 3. 改功能时去哪里

| 想改的内容 | 文件 |
| --- | --- |
| 关卡编号、旋转和干扰片数量 | AiGameAdmin 的「瓷器关卡」 |
| 棱角切片与原图保存 | AiGameApi 的 `app/services/artwork.py`、`app/services/levels.py` |
| 碎片叠放、吸附、整组移动、旋转和解锁规则 | `src/core/puzzle.js` |
| 竖屏布局、按钮、桌面颜色和藏品柜 | `src/core/view.js` |
| 游戏流程、触摸会话、存档时机 | `src/main.js` |
| Canvas、触摸事件、素材加载和本地存储适配 | `src/platform/mini-game.js` |
| 两端入口及 IDE 配置模板 | `platforms/wechat/` 与 `platforms/douyin/` |

`dist/` 是生成目录。新增或重新生成瓷器后，可在后台查看整器与碎片预览，再上架该关。

内置字体包含当前界面的文字，系统字体作为后备。如需把新文案加入内置字体，可使用 Python 与 fontTools，运行 `python scripts/subset-font.py <NotoSansCJKsc-Regular.otf 的路径>` 后重新构建。字体授权说明在 `src/assets/jinyao-ui-OFL.txt`。

## 4. 验收

本地检查会在两端产物中模拟后端关卡和平台请求，验证配置按需加载、初始旋转片数、干扰片、正向计时、下一关预取、每日收藏和月榜兑奖。

在微信和抖音模拟器各点一次「编译」后，检查已配置的关卡编号和碎片数量。拼完当前关后进入下一关，确认图集已预取，并验证切到后台时计时暂停。

这份工程在交付环境中完成了本地构建和模拟接口检查。微信、抖音官方 IDE 和真机运行需要用各自平台的开发者账号验证。原网页、微信、抖音使用各自的存档，首次打开小游戏会从第一关开始。
# AiGame
