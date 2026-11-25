# 金缮夜馆双端工程

- 从工程根目录执行 `node scripts/build.js --env dev|master` 和 `node scripts/check.js`。
- 后台有两套环境：`dev` 指本机 AiGameApi（127.0.0.1:8000），`master` 指服务器已发布接口。地址写在 `appids.local.json` 的 `apiUrls`，`env` 是默认环境；构建会把选中的地址写进 `dist/*/platform/online-config.js`。
- 关卡目录、玩家身份（`/me/guest`）和进度存档全部来自后台；本地六关只在后台连不上时作离线兜底，首页会标注。不要为了省事改回本地数据。
- 共享玩法和界面放在 `src/`，小游戏入口和平台配置模板在 `platforms/`。通过脚本生成 `dist/wechat` 和 `dist/douyin`。
- 游戏运行时使用小游戏 Canvas 2D。平台调用集中在 `src/platform/mini-game.js`，入口各自传入 `wx` 或 `tt`。
- 核心玩法是手机竖屏单桌面。未拼合的碎片可自由留在桌面任意可见位置，并可重叠。准确对齐的相邻裂边才吸附，已吸附的整组可以拖动和旋转。
- 六关使用原创瓷器图集。换图或新增关卡时同时维护碎片的裁剪尺寸、多边形、裂边邻接和描金点。
- 改动游戏逻辑后检查两端产物。报告本地验证和官方开发者工具验收分别进行到了哪一步。
