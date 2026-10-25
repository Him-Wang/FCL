# 在 Mac 上安装 FCL

> 这份说明写给**第一次在 Mac 上装非 App Store 软件**的人。全程不需要懂技术，照着做就行。
> 大约 3 分钟。

---

## 第 0 步：先确认你的 Mac 是什么芯片

这一步决定你该下载哪个安装包。

1. 点屏幕左上角的  → **关于本机**
2. 看「芯片」那一行：
   - 写着 **Apple M1 / M2 / M3 / M4** → 你要下 **arm64** 版
   - 写着 **Intel Core i5 / i7 / i9** → 你要下 **x64** 版

> 不确定也没关系：下错版本会提示"无法打开"，换成另一个再装一次即可。

---

## 第 1 步：下载

打开 [Releases 页面](https://github.com/Him-Wang/FCL/releases/tag/v1.0.0-macos)，点对应你的那个：

| 你的芯片 | 下载这个文件 |
| --- | --- |
| Apple M 系列 | `FCL-1.0.0-mac-arm64.dmg` |
| Intel | `FCL-1.0.0-mac-x64.dmg` |

下载完成后，文件通常在「下载」文件夹里（Dock 栏右边那个向下的箭头）。

---

## 第 2 步：安装（拖进「应用程序」）

1. **双击**下载好的 `.dmg` 文件
2. 会弹出一个窗口，里面有一个 **FCL** 图标，旁边是「应用程序」文件夹的快捷方式
3. **按住 FCL 图标，拖到「应用程序」上松手**
4. 拖完之后，在桌面/窗口右上角点 ⏏ 或者按 `Command + E` 把 dmg 弹出来

到这一步，FCL 已经装好了，位置在：**访达 → 应用程序 → FCL**。

---

## 第 3 步：第一次打开（最关键的一步）

因为 FCL **没有向苹果付费做开发者签名**，macOS 第一次会拦住它。这是所有非 App Store 软件都会遇到的，**不是病毒**。

正确姿势：

1. 打开 **访达 → 应用程序**
2. **右键点 FCL**（触控板上是双指轻点，或者按住 `Control` 再点一下）
3. 菜单里选 **「打开」**
4. 弹出对话框会写着"无法验证开发者"，但这次有 **「打开」** 按钮 —— 点它
5. 之后就可以正常双击启动了，**只需要做这一次**

> 如果你直接双击了，只会看到「无法打开」的提示，**没有「打开」按钮**。这时候点「好」，然后按上面的右键流程重来一次。

---

## 第 4 步：如果提示「FCL 已损坏，无法打开」怎么办

这是最常见的一种，原因是浏览器给下载的文件打了个"隔离标记"，而 FCL 没有苹果签名。

解决只需要在「终端」里粘一行命令，步骤如下：

### 4.1 打开终端

- 按 `Command + 空格` 打开聚焦搜索
- 输入 `终端`（英文系统输入 `Terminal`）
- 回车，会出现一个黑色/白色的窗口

### 4.2 复制下面这一行，粘贴进终端，回车

```bash
xattr -dr com.apple.quarantine /Applications/FCL.app
```

> 粘贴用 `Command + V`。如果提示要输入密码，输入的是**你开机的密码**（输入时屏幕上不显示字符，是正常的），输完回车。

### 4.3 重新打开

回「应用程序」双击 FCL 即可。

---

## 常见问题

<details>
<summary><b>提示「无法验证开发者」/「Apple 无法检查其是否包含恶意软件」</b></summary>

这是 Gatekeeper 的常规拦截。用**第 3 步的右键 → 打开**即可放行。
如果对话框里没有「打开」按钮，说明你的系统版本较新：
**系统设置 → 隐私与安全性 → 往下滚到最后**，会有一行「已阻止使用 FCL，因为来自身份不明的开发者」，点旁边的 **「仍要打开」**。
</details>

<details>
<summary><b>提示「FCL 已损坏，应该移到废纸篓」</b></summary>

99% 是隔离标记导致的，不是文件真坏了。执行第 4 步的 `xattr` 命令即可。
如果执行后仍报错，说明下载不完整 —— 删掉重新下载一次（网络中断会导致 dmg 损坏）。
</details>

<details>
<summary><b>双击图标后没有任何反应</b></summary>

1. 先确认你双击的是「应用程序」里的 FCL，不是下载文件夹里的 dmg；
2. 试试右键 → 打开；
3. 还是不行的话，打开终端执行：
   ```bash
   /Applications/FCL.app/Contents/MacOS/FCL
   ```
   终端里会打印具体报错，把内容发到 issue。
</details>

<details>
<summary><b>能打开，但启动游戏失败 / 卡在"部署 Java"</b></summary>

macOS 的 Java 由启动器自动下载（Adoptium 的 mac 构建）。如果长时间卡住：
1. 检查网络是否被代理拦了 `api.adoptium.net`；
2. 手动装一个也行：终端执行 `brew install --cask temurin`，然后在 FCL 设置里把 Java 路径指向
   `/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home`。
</details>

<details>
<summary><b>游戏里模组/皮肤不生效</b></summary>

- 模组、材质包、光影、皮肤都需要 **Fabric / Forge / NeoForge** 版本，纯原版加载不了 mod；
- 离线账号的皮肤靠内置的 CustomSkinLoader，第一次装好后进一次游戏，让它生成配置；
- 进游戏后如果皮肤还是默认的，检查 `游戏目录/mods/` 里有没有 `CustomSkinLoader_*.jar`。
</details>

<details>
<summary><b>日志在哪里？（报错时先把这个发给我）</b></summary>

```
~/Library/Application Support/FCL-Portable/logs/app.log
```

在访达里按 `Command + Shift + G`，粘贴上面这行（去掉开头的 `~` 也行，直接把整行粘进去会自动展开），回车。
也可以直接贴这一行到终端里看：

```bash
open "$HOME/Library/Application Support/FCL-Portable/logs"
```
</details>

<details>
<summary><b>数据存在哪？怎么彻底卸载？</b></summary>

- 程序：`/Applications/FCL.app`
- 数据、游戏、Java、日志：`~/Library/Application Support/FCL-Portable/`（里面的 `game/` 就是你的存档和版本）
- **彻底卸载**：把 FCL.app 拖到废纸篓，再删掉上面那个 `FCL-Portable` 文件夹即可。不写注册表、不留后台服务。
- **只想重装、保留存档**：把 `FCL-Portable` 文件夹备份出来，换新版本后放回原处。
</details>

<details>
<summary><b>怎么更新到新版本？</b></summary>

下载新版本的 dmg，把 FCL 拖进「应用程序」时选择**替换**。
数据在 `~/Library/Application Support/FCL-Portable/`，不会被动到，账号、版本、皮肤都还在。
</details>

---

## 一句话总结

| 情况 | 做法 |
| --- | --- |
| 第一次打开 | 右键 FCL → 打开 → 再点「打开」 |
| 提示"已损坏" | 终端跑 `xattr -dr com.apple.quarantine /Applications/FCL.app` |
| 提示"无法验证开发者" | 右键打开，或 系统设置 → 隐私与安全性 → 仍要打开 |
| 报错要反馈 | 发 `~/Library/Application Support/FCL-Portable/logs/app.log` |
