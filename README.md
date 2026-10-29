# FCL · FishCraftLauncher

> 一个绿色便携的 Minecraft 启动器：双击 exe，版本、模组、光影、皮肤和 Java 全在它旁边的 `FCL\` 文件夹里。

<p>
  <img alt="platform" src="https://img.shields.io/badge/Windows-x64-2b7bf0">
  <img alt="electron" src="https://img.shields.io/badge/Electron-33.4-47848f">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-00c29a">
  <img alt="version" src="https://img.shields.io/badge/version-1.4.6-4d6bfe">
  <a href="https://github.com/Him-Wang/FCL/graphs/contributors"><img alt="contributors" src="https://img.shields.io/github/contributors/Him-Wang/FCL?color=2b7bf0&label=contributors"></a>
</p>

![FCL 启动页](docs/screenshots/launch.jpg)

> **关于旧名字**：项目原名 **FMCL**（FishMineCraftLauncher），自 1.1.0 起改名为 **FishCraftLauncher（FCL）**，程序名、标题、数据目录都换成了 FCL。仓库地址从 `Him-Wang/FMCL` 迁到 `Him-Wang/FCL`，旧链接会自动跳转。从旧版升级只需把新 exe 放到旧 exe 同目录，首次启动会把 `FMCL\` 自动迁移成 `FCL\`。

---

## 特性

### 一键启动

- 点一次「启动游戏」：选账号 → 检查版本 → 补全依赖与资源 → 部署 Java → 启动
- 启动前**校验资源完整性**（assets / libraries 缺什么补什么），修掉「装到一半中断 → 进游戏闪退」
- 崩溃后自动读取 `crash-reports` 里最新的报告，把异常类写进启动日志

### 版本与加载器

- 正式版 / 快照 / **Fabric / Forge / NeoForge** 一键安装，下载队列 3 并发
- **远古版与愚人节版**：单独的「远古版」（old_alpha / old_beta，共 61 个）与「愚人节」分类，老版本自动选用 Java 8
- 装加载器前会**先确保原版就位**；没装 Java 时自动部署（26.x→25、1.20.5+→21、1.17+→17、更早→8）
- 版本选择器只列已安装的版本，缺基础原版的加载器版本会直接标注原因
- 删除版本走回收站，可反悔

### 模组 / 材质包 / 光影

- **Modrinth** 在线搜索、一键安装（按当前版本 + 加载器过滤兼容文件）
- **MC百科**中文模组搜索，补足 Modrinth 中文生态偏弱的问题
- 已装模组可启用 / 禁用 / 删除；材质包与光影支持启用、禁用、排序
- 资源管理器的 zip / jar 可直接拖进来导入

### 皮肤

- **6 套内置经典皮肤**（史蒂夫·蓝 / 艾莉克斯·橙 / 绿帽连帽衫 / 红卫衣 / 黄金骑士 / 肥鱼·FCL），开箱即用
- 皮肤设置分三块：左侧**大预览**（按 64×64 皮肤 UV 绘制，含帽子 / 外套 / 袖子 / 裤腿覆盖层，和游戏内一致）、右侧模型切换与皮肤库网格、底下一行操作
- 本地 PNG 导入（64×64 / 64×32，放大图自动缩回 64×64），Steve / Alex 身材随时切换
- **内置 CustomSkinLoader**：换皮肤时自动装匹配的 CSL 构建，离线账号进游戏也能看到自己的皮肤
- **微软账号**：登录时自动同步官方皮肤（头像取自皮肤头部），换好后可一键上传到官方服务器

### 界面

- **磨砂玻璃 + 整窗圆角**：卡片、侧栏、壁纸统一 `backdrop-filter`，窗口四角真正透出桌面；背景不透明度 30%–100% 实时生效
- **外观只有一个入口**：右下角圆形按钮循环「浅色 → 深色 → 跟随系统」，没有主题色板
- 设计系统拆成两层：`css/tokens.css` 只声明变量，`css/app.css` 只引用变量（见 `design.md`）
- **托盘常驻**，点 × 的行为三选一：**每次询问 / 最小化到托盘 / 直接退出**

> 截图使用浅色主题。

| | |
| --- | --- |
| ![版本管理](docs/screenshots/versions.jpg) | ![模组管理](docs/screenshots/mods.jpg) |
| ![材质包与光影](docs/screenshots/packs.jpg) | ![皮肤](docs/screenshots/skin.jpg) |

设置页（左）与关于页（右）：

| | |
| --- | --- |
| ![设置](docs/screenshots/settings.jpg) | ![关于](docs/screenshots/settings-about.jpg) |

### 绿色便携

运行后不往用户目录写东西，全部收在 exe 同级：

```text
FCL\
├─ data\    设置 / 账号 / 皮肤库 / 浏览器缓存
├─ game\    游戏目录（versions / mods / resourcepacks / shaderpacks / assets / libraries）
├─ java\    一键部署的 Java 运行时
├─ logs\    日志与崩溃转储
└─ temp\    启动器与游戏的临时文件（游戏、Forge 安装器都继承这个 TEMP）
```

- 整包拷到 U 盘或另一台电脑即可继续用，配置跟着走
- 想放别的盘：设置 →「启动器根目录」→ 更改（写入 `FCL\config.json`，重启生效）

---

## 下载

Release 名称：**`FCL <版本> · Windows`**。

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows x64 | `FCL-<版本>-x64.exe` | 单文件便携版，无需安装 |

- Windows 首次启动没有 Java 也能用：点「启动游戏」会自动部署 Java
- 未做代码签名，首次运行 SmartScreen 会提示一次，点「更多信息 → 仍要运行」即可

## 从源码运行

```bash
git clone https://github.com/Him-Wang/FCL.git
cd FCL
npm install
npm start
```

要求：Node.js ≥ 18；Windows 10/11 x64。

```bash
npm run dist       # Windows：产物 dist/FCL-<版本>-x64.exe
```

> Windows 用 `tools\package-win.cmd` 打包更稳：它把临时目录、electron 二进制、镜像都固定在项目内，避免写到系统临时目录。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面框架 | Electron 33.4；无边框窗口 + 透明背景 + contextIsolation preload |
| 界面 | 原生 HTML / CSS / JavaScript，无前端框架 |
| Minecraft 核心 | [@xmcl/core](https://github.com/Voxelum/x-minecraft-launcher)（版本解析、启动、进程监听）、[@xmcl/user](https://github.com/Voxelum/x-minecraft-launcher)（微软 OAuth2） |
| 模组与资源 | Modrinth API、MC百科 |
| 下载 | 自研 `lib/net.js`：连接 / 空闲超时、重定向跟随、镜像回退、原子 `.part` 下载、SHA-1 校验 |
| 打包 | electron-builder（Windows portable 单文件） |

国内网络优先走 **BMCLAPI / 阿里云 maven / 清华 Adoptium / 华为云 OpenJDK** 镜像，官方源兜底；`meta.fabricmc.net`、`maven.fabricmc.net` 在国内经常直连超时，所以 **Fabric / Forge 的元数据与依赖默认镜像优先**。

## 项目结构

```text
main.js              主进程：窗口、IPC、安装编排、下载队列、便携目录
preload.js           暴露给渲染进程的受限 API
index.html           单页结构 + SVG 图标精灵
js/app.js            渲染进程：页面状态、交互、皮肤 / 模组 / 设置等 UI 逻辑
js/data.js           内置静态数据（新闻兜底等）
css/tokens.css       设计变量层：颜色 / 字号 / 间距 / 圆角 / 层次
css/app.css          组件与布局：只引用变量
design.md            设计系统契约（规则、基元、反模式）
lib/installer.js     版本安装、镜像探测、资源校验
lib/java.js          Java 探测与一键部署
lib/modstore.js      Modrinth 搜索与安装
lib/cnmod.js         MC百科中文搜索（含缓存与单飞）
lib/localskin.js     CustomSkinLoader 集成（自带构建、配置修补、皮肤写入）
lib/net.js           网络与下载工具
lib/microsoft.js     微软登录（内嵌窗口 + 浏览器回调兜底）
assets/skins/        6 套内置皮肤（64×64 PNG）
assets/csl/          内置的 CustomSkinLoader 构建 + manifest
tools/               图标生成、皮肤生成、CSL 拉取、打包脚本
```

## 配置

- **微软登录**：点「使用微软账号登录」弹出内嵌登录窗口，登完自动添加账号，**不需要自己注册 Azure 应用**；内嵌窗口被拦时可用「浏览器登录」把回调链接粘回来
- **内存 / JVM 参数 / 窗口尺寸 / 关闭行为**：设置页可调，默认 4 GB

## 稳定性

- **单实例**：重复双击只把已有窗口拉到前台，不会两个进程抢同一个数据目录
- **崩溃留痕**：主进程异常、渲染 / GPU 子进程退出、窗口意外关闭、渲染层未捕获错误，全部写进 `logs\app.log`
- **下载韧性**：连接 10s / 空闲 20s 超时、镜像回退、原子 `.part` 写入、SHA-1 校验；遇到杀软占用（EPERM / EBUSY）自动退避重试
- **安装校验**：Java 与版本文件下载解压后校验关键文件，缺文件自动清理重试
- **启动前体检**：版本文件缺失、基础原版缺失都会先给可读提示，而不是抛 ENOENT
- **日志上限**：日志面板最多保留 400 行，长时间挂机不涨内存

## 常见问题

<details>
<summary>杀软 / SmartScreen 报警？</summary>

exe 未做代码签名，属于常见误报。可下载后自行校验 SHA256，或用源码运行。
</details>

<details>
<summary>双击没反应 / 一开就退？</summary>

绝大多数是环境里被设置了 `ELECTRON_RUN_AS_NODE=1`（会把 Electron 程序当普通 Node 跑）。1.3.7 起启动器会检测并自动重新拉起自己；旧版本请先删掉这个环境变量。
</details>

<details>
<summary>Fabric / Forge 装不动或报错？</summary>

1.3.9 起：加载器安装前会先装原版，缺 Java 会自动部署。若仍失败，多半是网络到 `meta.fabricmc.net` / `maven.fabricmc.net` 不通 —— 启动器已改为镜像优先，可再试一次；还不行就检查系统代理是否拦截了 `bmclapi2.bangbang93.com`。
</details>

<details>
<summary>离线账号进游戏没有皮肤？</summary>

皮肤靠 CustomSkinLoader 加载。切换到 **Fabric / Forge / NeoForge 版本**后启动器会自动装 CSL；纯原版无法加载 mod，只能显示默认皮肤。首次装好后先进一次游戏让 CSL 生成配置。
</details>

<details>
<summary>为什么只有一个 exe？卸载后残留什么？</summary>

便携版不写注册表、不装服务，删除 exe 与它旁边的 `FCL\` 即彻底卸载。
</details>

## 已知限制

- Windows 为便携单文件，未适配 Linux / macOS
- 未做代码签名，首次运行 SmartScreen 会提示一次，手动放行即可
- 皮肤模组依赖 CustomSkinLoader 对目标 MC 版本的兼容性，极新的快照可能尚未适配
- 内置 CSL 构建截至发布时刻，遇到新版本可在 `assets/csl` 补充

## 致谢

- [@xmcl/core](https://github.com/Voxelum/x-minecraft-launcher) · [@xmcl/user](https://github.com/Voxelum/x-minecraft-launcher)
- [Modrinth](https://modrinth.com) API · [MC百科](https://www.mcmod.cn)
- [BMCLAPI](https://bmclapidoc.bangbang93.com) · 阿里云 / 腾讯云 maven 镜像
- [Adoptium](https://adoptium.net) · 清华 TUNA · 华为云 OpenJDK 镜像
- [CustomSkinLoader](https://github.com/xfl03/MCLoader)（内置构建，MIT）
- 界面重构来自 **[PR #1](https://github.com/Him-Wang/FCL/pull/1)**（作者 [@ImAlexBlock](https://github.com/ImAlexBlock)）：样式分层、深色模式与对比度修复、无障碍改造、`design.md`

## 作者

| 角色 | 成员 | 负责 |
| --- | --- | --- |
| 作者 | **Hermintway** | 项目发起人 · 需求与验收 |
| 共同创造 | **DeepSeek Harness（DSH）** | 架构与代码实现：安装与下载链路、镜像策略、Java 一键部署、下载队列、模组与中文搜索、材质包与光影、皮肤系统、界面与打包发布 |
| 共同创造 | **WorkBuddy** | 初版界面原型：PCL 风格布局、主题配色、像素头像与鱼形图标，以及早期 xmcl 接入与交付文档 |
| 界面重构 | **AlexBlock（[@ImAlexBlock](https://github.com/ImAlexBlock)）** | 设计变量与组件样式分层、深色模式与对比度修复、无障碍改造、`design.md` |

## License

[MIT](LICENSE)
