# 金缮夜馆 · 微信和抖音小游戏 1

两端共用 JavaScript 游戏逻辑、Canvas 2D 画面和六件瓷器素材。碎片可以在竖屏桌面上自由拖放、重叠。相邻裂边的位置和方向对齐时吸附，拼起来的碎片可以整组拖动。第三关起可旋转，拼完整后描金、入藏并解锁下一关。进度按各端的本地存储分别保存。

## 1. 先在开发者工具里跑起来

解压 `jinyao-minigames.zip`。压缩包内已有两份生成好的工程，可以直接导入对应目录。

| 平台 | 导入目录 | 操作 |
| --- | --- | --- |
| 微信小游戏 | `dist/wechat/` | 打开微信开发者工具，导入小游戏目录，选择你的微信小游戏 AppID，然后点「编译」。开发者工具如果提供测试号选项，可以用它做本地模拟器调试。 |
| 抖音小游戏 | `dist/douyin/` | 打开抖音开发者工具，在小游戏项目列表中导入或关联该目录，填入抖音小游戏 AppID，然后点「编译」。如果导入需要先设置项目类型，选择「小游戏」。 |

真机扫码预览需要在对应开发者工具里登录有项目权限的账号，并使用对应平台的小游戏 AppID。导入目录的根部能直接看到 `game.js` 和 `game.json`。两份工程都带有本地 PNG 资源，游戏运行无需接后端。

[微信开发者工具下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) · [抖音开发者工具下载](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/dev-tools/developer-instrument-update-and-download) · [抖音小游戏新手教程](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/dev-guide/newbie-tutorial)

## 2. 用 VS Code 里的 Codex 开发

1. 安装 Node.js 18 或更高版本。用 VS Code 打开包含 `AGENTS.md`、`package.json` 和 `src/` 的 **`jinyao-minigames` 根目录**。
2. 打开 Codex 扩展并登录。扩展会读取根目录的 `AGENTS.md`，其中写有玩法约束、源码入口和验收命令。如果使用 Codex CLI，也可以在工程根目录执行 `codex`。
3. 把功能和验收条件一起交给 Codex。让它修改 `src/`，运行构建和本地检查，再去两个平台的开发者工具里分别编译。

示例任务可以直接粘贴到 Codex。

> 读取 AGENTS.md 和 README.md。把第一关的吸附距离改为 18，保持其余关卡不变。错片仍可重叠并停在原处，正确相邻的碎片拼好后仍可整组拖动。修改共享源码，执行 node scripts/build.js 和 node scripts/check.js，告诉我改了哪些文件、怎样在微信和抖音模拟器验收。

本地命令都从根目录运行，无需执行 npm install。

```powershell
node scripts/build.js
node scripts/check.js
```

只生成一端时使用 `node scripts/build.js wechat` 或 `node scripts/build.js douyin`。若使用 IDE 编辑了输出目录的 `project.config.json`，构建脚本会保留已有 AppID。也可以复制 `appids.example.json` 为 `appids.local.json` 并填入两端各自的 AppID，之后构建会优先使用它。

[Codex 的 VS Code 扩展](https://developers.openai.com/codex/ide/) · [AGENTS.md 指南](https://developers.openai.com/codex/guides/agents-md)

## 3. 改功能时去哪里

| 想改的内容 | 文件 |
| --- | --- |
| 名称、难度、文案、旋转设置、吸附距离 | `src/core/levels.js` |
| 碎片叠放、吸附、整组移动、旋转、描金和解锁规则 | `src/core/puzzle.js` |
| 竖屏布局、按钮、桌面颜色和藏品柜 | `src/core/view.js` |
| 游戏流程、触摸会话、存档时机 | `src/main.js` |
| Canvas、触摸事件、素材加载和本地存储适配 | `src/platform/mini-game.js` |
| 六套 PNG 图集、碎片多边形、裂边和描金点 | `src/assets/` 与 `src/core/geometry.js` |
| 两端入口及 IDE 配置模板 | `platforms/wechat/` 与 `platforms/douyin/` |

`dist/` 是生成目录。提交代码时保留共享源码、构建脚本、平台模板和文档。新瓷器需要同步追加游戏配置、图集裁剪矩形、碎片轮廓和相邻裂边，先用本地检查验证裂边能连成一件完整瓷器。

内置字体包含当前界面的文字，系统字体作为后备。如需把新文案加入内置字体，可使用 Python 与 fontTools，运行 `python scripts/subset-font.py <NotoSansCJKsc-Regular.otf 的路径>` 后重新构建。字体授权说明在 `src/assets/jinyao-ui-OFL.txt`。

## 4. 验收

本地检查会跑两份实际生成的 `game.js`，用模拟平台 API 验证竖屏配置、图片路径、错片叠放、相邻吸附、整组拖动、触摸取消、描金、关卡解锁和存档。同时检查六关的裂边能连成完整瓷器。

在微信和抖音模拟器各点一次「编译」后，拖动第一关瓶口碎片叠到瓶底上，确认两片可分别移动。再把瓶口与中段拼合，确认整组能拖动。拼完整后点三处金点，确认能解锁第二关。第三关检查「顺转 90°」，并重新打开游戏核对保存的位置。

这份工程在交付环境中完成了本地构建和模拟接口检查。微信、抖音官方 IDE 和真机运行需要用各自平台的开发者账号验证。原网页、微信、抖音使用各自的存档，首次打开小游戏会从第一关开始。
# AiGame
