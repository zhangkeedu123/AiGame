# 先用 Codex 调试，再用微信开发者工具验收

## 安装到现有项目

把本补丁的 `scripts`、`preview` 两个目录合并到 `jinyao-minigames` 项目根目录，也就是含有 `AGENTS.md`、`package.json` 和 `src` 的那一层。补丁只新增浏览器预览入口，现有的 `src`、`dist`、`.gitignore` 以及 AppID 配置可以原样保留。

## 一、本地预览 

在 VS Code 打开项目根目录。在同一台电脑的终端运行：

```powershell
node scripts/preview.js
```

使用 Node.js 18 或更高版本。保持终端运行，用 Chrome 或 Edge 打开 [http://127.0.0.1:4173](http://127.0.0.1:4173)。如果端口被占用，运行 `node scripts/preview.js 4174`，打开终端打印的新地址。

要试玩线上关卡，将 `appids.example.json` 复制为 `appids.local.json`，把 `apiUrls` 里两套后台地址填好。关卡目录、玩家身份和存档都从后台读，两套环境是两套库：

| 环境 | 默认指向 | 用途 |
| --- | --- | --- |
| `dev` | `http://127.0.0.1:8000`（本机 AiGameApi） | 本地联调、改代码后即时验证 |
| `master` | 服务器已发布接口 | 线上包、验收真实数据 |

`env` 字段决定连哪套，**页面上没有切换入口**：把 `"env"` 改成 `dev` 或 `master`，重启预览即可；微信和抖音构建同样读这份 JSON，改完之后需要重新构建。临时切一次也可以带参数启动：`node scripts/preview.js --env dev`。两套环境是两套库，令牌与设备号分开存，不会串号。真机需要可访问的 HTTPS 地址，开发者工具里请勾选「不校验合法域名」。

如果使用本机 Codex 桌面端，也可以在它的内置浏览器打开同一个地址。使用 VS Code 扩展时，可以继续在编辑器里让 Codex 修改源码，同时在 Chrome 或 Edge 里刷新验证。

预览会从当前 `src/main.js` 加载同一套玩法和 Canvas 界面。修改后保存文件，按 Ctrl+R 刷新即可。按 F12 查看 Console 报错。需要回到第一关时，可以用页面上的「清除预览存档」。网页预览使用本机浏览器存储，微信存档由微信运行时处理。终端里按 Ctrl+C 可以停止服务。

给 Codex 的示例任务：

> 先读 AGENTS.md 和 PREVIEW.md。用 node scripts/preview.js 启动本地预览，打开浏览器核验。拖动碎片，检查碎片序号、错片叠放不吸附、正确裂边吸附、整组拖动、刷新恢复和拼齐后直接解锁下一关。发现问题先修 src 中的共享源码并回归，最后执行 node scripts/build.js 和 node scripts/check.js。告诉我浏览器里实际验证了什么，以及微信模拟器还应验证什么。

浏览器阶段可以验收画面、关卡、拼接、鼠标和浏览器触摸事件。这个入口只供本机开发，供微信使用的入口仍由构建生成。

## 二、微信开发者工具验收

浏览器体验正常后，在根目录新开一个终端：

```powershell
node scripts/build.js
node scripts/check.js
```

在微信开发者工具选择「小游戏」，导入 `dist/wechat`，或者回到已导入的工程点「编译」。这阶段检查微信模拟器和真机上的触摸坐标、安全区、图片字体加载以及本地存档。通过后点「预览」，用手机微信扫码试一遍。

预览服务只在启动它的电脑上监听。如果在远程 Codex 环境启动，需要通过该环境的预览或端口转发访问；你在本机 VS Code 终端启动时，可以直接在本机浏览器访问。
