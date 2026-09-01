# VPNGate to Mihomo (Clash Meta) 订阅转换 Worker

基于 Cloudflare Workers 的无服务器（Serverless）转换工具，将 [VPNGate](https://www.vpngate.net/) 官方提供的全球志愿者家宽 OpenVPN 节点，实时拉取并转换为 Mihomo (Clash Meta) 标准订阅 YAML 格式。

配合客户端的前置代理（`dialer-proxy` 链式代理）功能，可实现稳定突破连接限制，享受纯净家宽出口。

---

## 🌟 进阶特性

- 🏷️ **富文本节点展示**：自动在节点名中注入 **国旗 Emoji、带宽大小、当前在线人数、运行在线时长、节点 ID**。
  - 示例：`🇯🇵 JP | 104.2Mbps | 2人 | 5天 | vg12345678`
- ⚡ **智能排序与优选**：支持按 **带宽从大到小（默认）**、**连接人数最少**、**官方评分最高** 等多种方式智能排序。
- 🎯 **多维度条件过滤**：支持按 **国家（如只看日本/韩国）**、**最低带宽阈值**、**最大连接人数限制** 进行过滤。
- 🛡️ **安全鉴权**：内置 `token` 参数鉴权，防止接口被恶意扫描与滥用。
- 🚀 **边缘毫秒缓存**：基于 Cloudflare Edge Cache API (`caches.default`) 缓存 1 小时，响应极速。
- 📋 **标准兼容**：输出规范的 Mihomo OpenVPN 节点格式（支持 CA 证书、客户端 Cert/Key 多行格式）。

---

## 📖 订阅参数详解

你可以在订阅 URL 中添加以下参数自由定制节点输出：

```text
https://你的Worker域名/openvpn.yaml?token=你的Token&sort=speed&country=JP,KR&min_speed=20&max_users=10&limit=50
```

| 参数名 | 默认值 | 可选值 / 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `token` | *(必填)* | 你的鉴权密钥 | `token=JJmi1vwut...` |
| `sort` | `speed` | **排序方式**：<br>• `speed`: 带宽从大到小<br>• `users`: 连接人数从小到大（人少优先）<br>• `score`: VPNGate 官方评分从高到低<br>• `ping`: 官方延迟从小到大 | `sort=speed`<br>`sort=users` |
| `country` | *(全部)* | **国家代码筛选**（逗号分隔）：<br>如 `JP`(日本)、`KR`(韩国)、`US`(美国)、`TW`(台湾) | `country=JP`<br>`country=JP,KR` |
| `min_speed` | `0` | **最低带宽限制 (Mbps)**，自动剔除小水管节点 | `min_speed=30`（只保留 ≥30M 的节点） |
| `max_users` | `999999`| **最大在线人数限制**，剔除拥挤节点 | `max_users=10`（只保留当前 ≤10 人的节点） |
| `limit` | `80` | **最多返回节点数**，避免节点过多导致订阅体积庞大 | `limit=40` |
| `proto` | `tcp` | **协议筛选**：<br>• `tcp`（默认，前置代理中转最稳定）<br>• `udp`<br>• `all` | `proto=tcp` |

---

## 🚀 常用订阅组合推荐

1. **🔥 高速大带宽专线（推荐日常使用）**：
   ```text
   https://你的Worker域名/openvpn.yaml?token=你的Token&sort=speed&min_speed=30&limit=40
   ```
2. **👥 低负载冷门节点（适合看流媒体防跳验证码）**：
   ```text
   https://你的Worker域名/openvpn.yaml?token=你的Token&sort=users&max_users=5&country=JP,KR
   ```
3. **🇯🇵 纯日本高质家宽专线**：
   ```text
   https://你的Worker域名/openvpn.yaml?token=你的Token&country=JP&sort=speed&limit=50
   ```

---

## 💻 客户端配置（Mihomo / Clash Meta）

在你的 Mihomo (Clash Meta) 配置文件中，使用 `proxy-providers` 配合 `override.dialer-proxy` 前置代理进行中转：

```yaml
proxies:
  # 填入你自己的优质前置节点（如自建的香港/日本/新加坡 VPS 节点）
  - name: "My-Front-Proxy"
    type: ss # 或 vmess / vless / trojan / hysteria2
    server: 1.2.3.4
    port: 443
    # ... 其他节点参数 ...

proxy-providers:
  vpngate:
    type: http
    url: "https://你的Worker域名/openvpn.yaml?token=你的Token&sort=speed&country=JP,KR&min_speed=20"
    path: ./provider/vpngate.yaml
    interval: 3600
    health-check:
      enable: true
      interval: 600
      url: http://www.gstatic.com/generate_204
    override:
      # 核心：将所有 VPNGate 家宽流量通过你的前置节点中转
      dialer-proxy: "My-Front-Proxy"

proxy-groups:
  - name: "家宽节点选择"
    type: select
    use:
      - vpngate

  - name: "家宽自动优选"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    use:
      - vpngate
```

---

## 🛠️ 部署步骤

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Compute (Workers & Pages)**。
2. 点击 **Create Worker**，将 `src/index.js` 代码复制进去并点击 **Save and deploy**。
3. 也可以直接通过命令行使用 `npx wrangler deploy` 部署。
