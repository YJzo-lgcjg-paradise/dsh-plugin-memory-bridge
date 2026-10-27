# dsh-memory-bridge

把 DeepSeek Harness 的对话窗口接到「大肥鱼」记忆库。装完后在 DSH 的**设置**里多一页「记忆桥」。

## 它做什么

- 在设置栏里选一个记忆体，绑定给当前窗口
- 一键生成「记忆骨架」：人格锚点 + 最近事件的日记 + 没说完的线头 + 他给你看过的东西
- 另提供接口，按需取该记忆体最近 N 条对话原文

## 安装

先把大肥鱼桌面版启动（默认 `http://127.0.0.1:8790`），然后：

```bat
dsh plugin --profile desktop add "link:C:\Users\user\Desktop\dsh-plugin-memory-bridge"
```

装完**重启 DSH**。然后在 DeepSeek Harness 里打开：

```
设置 → 记忆桥
```

## 界面

| 项 | 说明 |
|---|---|
| 地址 | 记忆库地址，默认 8790，会自动退到 8787 |
| 记忆体 | 这个窗口使用的记忆体 |
| 最近对话条数 | 默认 10 |
| 保存绑定 | 写 `~/.dsh/memory-bridge.config.json` |
| 生成记忆骨架 | 调记忆库的 `/episodes/pack`，结果在下面的框里 |
| 复制 | 粘到新窗口第一句 |

## 接口（宿主侧）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET/POST | `/dsh-memory/api/config` | 读 / 写绑定 |
| GET | `/dsh-memory/api/spaces` | 列出记忆体 |
| GET | `/dsh-memory/api/pack` | 组装记忆骨架 |
| GET | `/dsh-memory/api/recent?n=10` | 最近 N 条对话原文 |

## 实现说明

- 宿主侧 `lib/index.js`：`inject: ['webServer']`，用 `webServer.register({kind:'exact'})` 注册接口
- 客户端 `lib/client.js`：`window.__ModuleLoader__.load(...)` + `ctx.slots.inject('settings.section')`
- `package.json` 里 `dsh.client.platform = "web"`，DSH 启动时才会加载客户端半边

## 现在的边界

「生成骨架 + 复制」已经可用，但**还没有做到每轮自动注入**——
那需要宿主提供「请求前改写上下文」的钩子，目前没有确认到。

## 卸载

```bat
dsh plugin --profile desktop remove dsh-memory-bridge
```
