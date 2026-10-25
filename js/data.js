/* 演示数据：版本 / 模组 / 新闻 */

/* 离线回退数据：正常运行时版本列表来自 Mojang 官方在线清单 */

const VERSIONS = [
  { id: '26.3', name: '26.3', type: 'release', date: '2026-09-15', size: '232 MB' },
  { id: '26.2', name: '26.2', type: 'release', date: '2026-06-16', size: '230 MB' },
  { id: '26.1.2', name: '26.1.2', type: 'release', date: '2026-04-09', size: '228 MB' },
  { id: '26.1.1', name: '26.1.1', type: 'release', date: '2026-04-01', size: '228 MB' },
  { id: '26.1', name: '26.1', type: 'release', date: '2026-03-24', size: '226 MB' },
  { id: '1.21.11', name: '1.21.11', type: 'release', date: '2025-12-09', size: '224 MB' },
  { id: '1.21.10', name: '1.21.10', type: 'release', date: '2025-10-07', size: '222 MB' },
  { id: '1.21.8', name: '1.21.8', type: 'release', date: '2025-07-17', size: '218 MB' },
  { id: '1.21.4', name: '1.21.4', type: 'release', date: '2024-12-03', size: '214 MB' },
  { id: '1.21.1', name: '1.21.1', type: 'release', date: '2024-08-08', size: '210 MB' },
  { id: '1.20.4', name: '1.20.4', type: 'release', date: '2023-12-05', size: '196 MB' },
  { id: '1.20.1', name: '1.20.1', type: 'release', date: '2023-06-12', size: '190 MB' },
  { id: '1.19.4', name: '1.19.4', type: 'release', date: '2023-03-14', size: '182 MB' },
  { id: '1.18.2', name: '1.18.2', type: 'release', date: '2022-03-01', size: '176 MB' },
  { id: '1.16.5', name: '1.16.5', type: 'release', date: '2021-01-15', size: '168 MB' },
  { id: '1.12.2', name: '1.12.2', type: 'release', date: '2017-09-18', size: '142 MB' },
  { id: '1.7.10', name: '1.7.10', type: 'release', date: '2014-06-26', size: '128 MB' },

  { id: '26.4-snapshot-5', name: '26.4-snapshot-5', type: 'snapshot', mc: '26.4', date: '2026-10-16', size: '236 MB' },
  { id: '26.4-snapshot-1', name: '26.4-snapshot-1', type: 'snapshot', mc: '26.4', date: '2026-10-02', size: '234 MB' },
  { id: '26.3-rc-3', name: '26.3-rc-3', type: 'snapshot', mc: '26.3', date: '2026-09-08', size: '232 MB' },

  { id: 'forge-1.20.1', name: 'Forge 1.20.1-47.3.0', type: 'forge', mc: '1.20.1', date: '2024-06-20', size: '38 MB' },
  { id: 'forge-1.19.2', name: 'Forge 1.19.2-43.5.0', type: 'forge', mc: '1.19.2', date: '2024-03-11', size: '36 MB' },
  { id: 'forge-1.18.2', name: 'Forge 1.18.2-40.2.21', type: 'forge', mc: '1.18.2', date: '2023-11-02', size: '35 MB' },
  { id: 'forge-1.16.5', name: 'Forge 1.16.5-36.2.39', type: 'forge', mc: '1.16.5', date: '2022-06-15', size: '31 MB' },
  { id: 'forge-1.12.2', name: 'Forge 1.12.2-14.23.5.2860', type: 'forge', mc: '1.12.2', date: '2019-03-01', size: '26 MB' },

  { id: 'fabric-1.21.4', name: 'Fabric 1.21.4-0.16.9', type: 'fabric', mc: '1.21.4', date: '2024-12-10', size: '12 MB' },
  { id: 'fabric-1.20.4', name: 'Fabric 1.20.4-0.15.11', type: 'fabric', mc: '1.20.4', date: '2024-05-22', size: '11 MB' },
  { id: 'fabric-1.20.1', name: 'Fabric 1.20.1-0.14.25', type: 'fabric', mc: '1.20.1', date: '2023-11-08', size: '10 MB' },
  { id: 'fabric-1.19.4', name: 'Fabric 1.19.4-0.14.19', type: 'fabric', mc: '1.19.4', date: '2023-04-20', size: '10 MB' },

  { id: 'of-1.20.4', name: 'OptiFine 1.20.4 HD U I7', type: 'optifine', mc: '1.20.4', date: '2024-04-11', size: '9 MB' },
  { id: 'of-1.19.4', name: 'OptiFine 1.19.4 HD U H7', type: 'optifine', mc: '1.19.4', date: '2023-06-02', size: '9 MB' },
  { id: 'of-1.12.2', name: 'OptiFine 1.12.2 HD U G5', type: 'optifine', mc: '1.12.2', date: '2022-08-19', size: '8 MB' }
];

const TYPE_LABEL = { release: '正式版', snapshot: '快照', forge: 'Forge', fabric: 'Fabric', optifine: 'OptiFine', local: '本地' };

/* 模组不再有示例数据：模组页只展示本机 mods 目录里的真实文件，
 * 在线下载走 Modrinth 开放 API（见 js/app.js 的 renderMods / modOnlineSearch）。 */
const MODS = [];

const NEWS = [
  { tag: '版本', title: '26.3 已发布', desc: '2026 年 9 月更新的正式版，版本列表在线实时同步。' },
  { tag: '快照', title: '26.4-snapshot-5', desc: '快照与预发布版在「快照」标签页可直接下载。' },
  { tag: '提示', title: '下载中心已接入 Modrinth', desc: '模组 / 材质包 / 光影可直接搜索并安装到对应目录。' }
];

/* 启动日志脚本（演示） */
const LAUNCH_STEPS = [
  { lv: 'info', msg: '正在初始化启动器…', d: 220 },
  { lv: 'info', msg: '读取配置文件 config.json', d: 180 },
  { lv: 'info', msg: '检测 Java 运行环境…', d: 320 },
  { lv: 'info', msg: '使用 Java 21.0.3 (Eclipse Adoptium)', d: 200 },
  { lv: 'info', msg: '检查版本资源完整性…', d: 420 },
  { lv: 'info', msg: '资源索引校验通过 (assets 1247/1247)', d: 300 },
  { lv: 'info', msg: '扫描模组目录，共 12 个模组', d: 280 },
  { lv: 'warn', msg: '检测到 2 个模组与当前版本不完全匹配，已跳过', d: 340 },
  { lv: 'info', msg: '生成 JVM 启动参数…', d: 260 },
  { lv: 'info', msg: '分配内存：4096 MB / 最大 4096 MB', d: 220 },
  { lv: 'info', msg: '启动 Minecraft…', d: 400 },
  { lv: 'game', msg: '[游戏] 正在加载世界资源…', d: 520 },
  { lv: 'game', msg: '[游戏] 已准备就绪', d: 380 }
];
