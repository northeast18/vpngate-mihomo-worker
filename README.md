# VPNGate to Mihomo (Clash Meta) 订阅转换 Worker (增强优选版)

基于 **Cloudflare Workers** 的无服务器（Serverless）轻量级转换工具。将 [VPNGate](https://www.vpngate.net/) 官方提供的全球志愿者家宽 OpenVPN 节点，实时拉取、**独家智能防拥挤优选**、丰富元数据并转换为 **Mihomo (Clash Meta)** 标准订阅 YAML 格式。

配合客户端的前置代理（`dialer-proxy` 链式代理）功能，可轻松实现稳定突破连接限制，享受纯净的日本、韩国等原生家庭宽带（ISP）出口。

---

## 🌟 核心特性与独家升级

- 🏷️ **富文本信息展示**：节点名中直观包含 **国旗 Emoji、真实带宽速率、当前在线人数、运行在线时长、物理 IP**。
  - 示例：`🇯🇵 JP | 52.8M | 2人 | 4天 | 221.44.173.56`
- 🧠 **独家智能家宽评分算法 (`sort=smart`)**：
  - **人少优先（大幅降低延迟与丢包）**：当前在线人数越少，评分呈指数级提高，绝不跟千人去挤同一个家宽光猫！
  - **稳定在线加权**：优先挑选稳定在线 2 小时~7 天以上的设备，排除刚上线几分钟容易拔线的不稳定节点。
  - **真实带宽与低 Ping 结合**：兼顾速率与当地延迟。
- ⚡ **链式代理参数直出 (`&dialer_proxy=...`)**：支持自动为所有节点注入 `dialer-proxy: "⚡ CF前置"` 等前置代理组，开箱即用，无需繁琐客户端配置。
- 🎯 **深度 TCP 协议提取**：全面扫描所有 OpenVPN remote 配置，精准提取 TCP 443 等常用穿透端口，可用 TCP 节点率大幅提升。
- 🛡️ **IP 物理去重**：自动过滤重复 DDNS，确保列表中的每一个节点都来自独立的日本居民家庭。
- 🚀 **边缘高速新鲜缓存**：默认 5 分钟 (300秒) 智能边缘缓存，既减轻对官方源站的请求，又保证随官方实时刷新，**彻底告别死节点**。
- 📦 **双模输出模式**：
  - 默认模式：输出标准 `proxies:` 节点列表，用于 `proxy-providers` 挂载。
  - 完整模式（`&full=1`）：自动生成包含 `🇯🇵 日本家宽(自动优选)`（fallback 容灾模式）、`🚀 节点选择` 及基础规则的完整独立 Clash 订阅。

---

## 📖 订阅参数详解

你的专属订阅地址为：

```text
https://你的Worker域名/?token=你的AUTH_TOKEN&country=JP&proto=tcp&sort=smart&max_users=5&min_speed=20&dialer_proxy=⚡ CF前置
```

| 参数名 | 默认值 | 可选值 / 说明 | 最佳推荐示例 |
| :--- | :--- | :--- | :--- |
| `token` | *(必填)* | 你的鉴权密钥（也可直接写在路径中 `/YOUR_TOKEN`） | `token=JJmi1vwut...` |
| `country` | `JP` | **国家代码筛选**（逗号分隔）：<br>如 `JP`(日本)、`KR`(韩国)、`US`(美国) | `country=JP` |
| `sort` | `smart` | **排序方式**：<br>• `smart`: **独家智能优选（人少+稳定+高速）**<br>• `users`: 在线人数从少到多<br>• `speed`: 带宽从大到小<br>• `score`: 官方评分从高到低<br>• `ping`: 官方延迟从低到高 | `sort=smart` |
| `dialer_proxy` | *(空)* | **链式前置代理名称**：直接为每个节点挂载 `dialer-proxy` | `dialer_proxy=⚡ CF前置` |
| `proto` | `tcp` | **协议筛选**：<br>• `tcp`（默认，配合 CF 链式代理最稳定）<br>• `udp`<br>• `all` | `proto=tcp` |
| `max_users` | `15` | **最大在线人数限制**，坚决剔除人满为患的拥挤节点（建议设为 3~5） | `max_users=5` |
| `min_speed` | `10` | **最低带宽限制 (Mbps)**，自动剔除小水管节点 | `min_speed=20` |
| `limit` | `40` | **最多返回节点数**，避免订阅体积过大 | `limit=30` |
| `cache_ttl` | `300` | **Cloudflare 边缘缓存秒数**（默认 5 分钟，随源站新鲜更新） | `cache_ttl=300` |
| `full` | `0` | **完整订阅模式**：设为 `1` 直接输出包含策略组与规则的独立订阅 | `full=1` |

---

## 💻 客户端接入指南

### 方式一：作为现有订阅的 Proxy Provider（强烈推荐）

在 Clash Verge / Mihomo 的配置文件或扩展脚本中加入：

```yaml
proxy-providers:
  VPNGATE-PRIVATE-JP:
    type: http
    url: "https://你的Worker域名/?token=你的AUTH_TOKEN&country=JP&proto=tcp&sort=smart&max_users=5&min_speed=20"
    path: "./providers/vpngate-private-jp.yaml"
    proxy: "⚡ CF前置"
    interval: 1800
    health-check:
      enable: true
      url: https://www.gstatic.com/generate_204
      interval: 600
      timeout: 10000
      lazy: true
    override:
      additional-prefix: "私享 JP | "
      dialer-proxy: "⚡ CF前置"
```

### 方式二：直接在 URL 中指定 dialer_proxy

如果你的客户端不支持 override，直接在 Worker URL 中加上：
`&dialer_proxy=⚡ CF前置`
Worker 返回的每个节点将自动包含 `dialer-proxy: "⚡ CF前置"`！
