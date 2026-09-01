# VPNGate to Mihomo (Clash Meta) 订阅转换 Worker

基于 **Cloudflare Workers** 的无服务器（Serverless）轻量级转换工具。将 [VPNGate](https://www.vpngate.net/) 官方提供的全球志愿者家宽 OpenVPN 节点，实时拉取、过滤、丰富元数据并转换为 **Mihomo (Clash Meta)** 标准订阅 YAML 格式。

配合客户端的前置代理（`dialer-proxy` 链式代理）功能，可轻松实现稳定突破连接限制，享受纯净的日本、韩国等原生家庭宽带（ISP）出口。

---

## 🌟 核心特性

- 🏷️ **富文本信息展示**：节点名中直观包含 **国旗 Emoji、带宽速率、当前在线人数、运行在线时长、节点 ID**。
  - 示例：`🇯🇵 JP | 104.2Mbps | 2人 | 5天 | vg12345678`
- ⚡ **多维度智能排序**：支持按 **带宽从大到小（默认）**、**连接人数最少**、**官方评分最高**、**Ping 延迟最低** 智能优选排序。
- 🎯 **精准条件过滤**：支持按 **国家代码（如 `country=JP,KR`）**、**最低带宽阈值**、**最大连接人数**、**传输协议** 进行定制化筛选。
- 🛡️ **双模 Token 鉴权**：支持 `?token=YOUR_TOKEN` 查询参数以及 `/YOUR_TOKEN` 路径两种访问模式，防范未授权扫描。
- 🚀 **边缘毫秒级缓存**：基于 Cloudflare Edge Cache API (`caches.default`) 进行 1 小时全球边缘缓存，响应极速且对源站零压力。
- 📋 **完美标准兼容**：输出标准 Mihomo `openvpn` 代理协议（支持 CA 证书、客户端 Cert/Key 多行 `|+` 缩进）。

---

## 🛠️ Cloudflare 部署教程

### 方式一：网页端部署（推荐，零命令行门槛）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Compute (Workers & Pages)**。
2. 点击 **Create application** -> **Create Worker**。
3. 给 Worker 起个名字（如 `vpngate-mihomo`），点击 **Deploy**。
4. 进入该 Worker，点击 **Edit code**，将本项目 [`src/index.js`](src/index.js) 中的代码复制并完全覆盖编辑器内容。
5. 点击 **Save and deploy** 即可上线。
6. *(可选)* 在 Worker 的 **Settings** -> **Variables and Secrets** 中添加 `AUTH_TOKEN` 环境变量修改默认密钥。

### 方式二：通过 Wrangler 命令行部署

```bash
# 1. 克隆项目
git clone https://github.com/northeast18/vpngate-mihomo-worker.git
cd vpngate-mihomo-worker

# 2. 登录并一键部署
npx wrangler login
npx wrangler deploy
```

---

## 📖 订阅参数详解

部署完成后，你的专属订阅地址为：

```text
https://你的Worker域名/?token=你的AUTH_TOKEN&sort=speed&country=JP,KR&proto=tcp&min_speed=20
```

| 参数名 | 默认值 | 可选值 / 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `token` | *(必填)* | 你的鉴权密钥（也可直接写在路径中 `/YOUR_TOKEN`） | `token=JJmi1vwut...` |
| `sort` | `speed` | **排序方式**：<br>• `speed`: 带宽从大到小（默认）<br>• `users`: 在线人数从少到多（人少优先）<br>• `score`: 官方评分从高到低<br>• `ping`: 延迟从低到高 | `sort=speed`<br>`sort=users` |
| `country` | *(全部)* | **国家代码筛选**（逗号分隔）：<br>如 `JP`(日本)、`KR`(韩国)、`US`(美国)、`TW`(台湾) | `country=JP`<br>`country=JP,KR` |
| `min_speed` | `0` | **最低带宽限制 (Mbps)**，自动剔除小水管节点 | `min_speed=30` |
| `max_users` | `999999`| **最大在线人数限制**，剔除人满为患的拥挤节点 | `max_users=10` |
| `limit` | `80` | **最多返回节点数**，避免订阅体积过大 | `limit=50` |
| `proto` | `tcp` | **协议筛选**：<br>• `tcp`（默认，前置代理中转最稳定）<br>• `udp`<br>• `all` | `proto=tcp` |

---

## 💻 客户端全通用配置教程（以 Clash Party / Mihomo Party 为例）

为了让任何订阅（无论是自建 VPS、还是不同名称的商业机场）都能一键接入，且**无需改代码即可在 UI 界面上随意切换前置中转节点**，推荐使用 **JavaScript 脚本覆写**。

### 1. 添加通用覆写脚本

1. 打开 **Clash Party / Mihomo Party** 客户端；
2. 进入左侧菜单 **【覆写】（Override）**；
3. 新建一个覆写（类型选择 **`JavaScript` / `JS`**），填入以下全通用代码：

```javascript
function main(config) {
  config.proxies = config.proxies || [];
  config['proxy-groups'] = config['proxy-groups'] || [];

  // 1. 提取当前订阅里的所有真实可用节点（自动剔除流量/到期/官网/重置等广告项）
  const realProxyNames = [];
  for (let p of config.proxies) {
    if (p.name && 
        !p.name.includes('流量') && 
        !p.name.includes('到期') && 
        !p.name.includes('重置') && 
        !p.name.includes('官网') &&
        !p.name.includes('剩余') &&
        !p.name.includes('套餐')) {
      realProxyNames.push(p.name);
    }
  }

  if (realProxyNames.length === 0) {
    realProxyNames.push('DIRECT');
  }

  // 2. 创建【前置中转选择】分组（让你能在界面上自由挑选任意前置节点）
  const frontProxyGroupName = '🚀 前置中转节点选择';
  config['proxy-groups'].unshift({
    name: frontProxyGroupName,
    type: 'select',
    proxies: realProxyNames
  });

  // 3. 注入 VPNGate 订阅，并将 dialer-proxy 绑定到【前置中转选择】分组
  config['proxy-providers'] = config['proxy-providers'] || {};
  config['proxy-providers']['vpngate'] = {
    type: 'http',
    url: 'https://你的Worker域名/?token=你的Token&sort=speed&country=JP,KR&proto=tcp',
    path: './providers/vpngate.yaml',
    interval: 3600,
    'health-check': {
      enable: true,
      interval: 600,
      url: 'http://www.gstatic.com/generate_204'
    },
    override: {
      // 核心：直接绑定到前置选择组，界面上点哪个就用哪个中转
      'dialer-proxy': frontProxyGroupName
    }
  };

  // 4. 创建【VPNGate 家宽选择】独立分组
  config['proxy-groups'].unshift({
    name: '🏠 VPNGate家宽选择',
    type: 'select',
    use: ['vpngate'],
    proxies: ['DIRECT']
  });

  // 5. 自动将【🏠 VPNGate家宽选择】注入到当前订阅的所有主选择组中
  for (let group of config['proxy-groups']) {
    if (group.type === 'select' && 
        group.name !== '🏠 VPNGate家宽选择' && 
        group.name !== frontProxyGroupName) {
      group.proxies = group.proxies || [];
      if (!group.proxies.includes('🏠 VPNGate家宽选择')) {
        group.proxies.unshift('🏠 VPNGate家宽选择');
      }
    }
  }

  return config;
}
```

4. 将脚本中的 `https://你的Worker域名/...` 替换为你的真实 Worker 订阅链接并保存；
5. 开启覆写开关（确保范围为全局），回到 **【配置】** 刷新你的订阅。

---

## 🎯 界面操作三步法（极简控制）

配置完成后，在客户端的 **【代理组】** 界面只需按以下 3 步设置：

| 步骤 | 对应分组 | 如何选择 | 说明 |
| :---: | :--- | :--- | :--- |
| **第 1 步** | **订阅主策略组**（如 `吹雪云` / `🔰 节点选择`） | 选择 **`🏠 VPNGate家宽选择`** | 让总流量流入家宽通道 |
| **第 2 步** | **`🏠 VPNGate家宽选择`** | 选择你想要的 **日本 / 韩国家宽节点** | 决定对外展示的目标家宽 IP |
| **第 3 步** | **`🚀 前置中转节点选择`** | 选择任意可用的 **亚太优化节点**（如日本/新加坡 VLESS） | 作为底层的过墙中转跳板 |

---

## ❓ 常见问题与排错指南 (FAQ)

### 1. 为什么前置节点用“美国/欧洲”时，家宽节点会全部超时？
* **物理延迟过高**：OpenVPN 握手需要 5~7 次往返。走跨洋美国节点绕地球大半圈，单次握手耗时超 4~6 秒，超过了客户端测速超时阈值。
* **端口拦截**：部分廉价美西 VPS 或 CDN 反代节点仅开放 80/443 端口，拦截了 VPNGate 的任意四层高端口。
* **最佳方案**：连日韩家宽时，前置中转务必选用 **日本、香港、台湾、新加坡** 等亚太地区低延迟节点。

### 2. 为什么切换了家宽节点，但浏览器查 IP 还是旧的？
* **浏览器 TCP 长连接复用（Keep-Alive）**：浏览器与测 IP 网站保持了活跃连接，刷新页面会复用旧通道。
* **解决方法**：在客户端点击左侧 **【连接】** -> 点击右上角 **【断开所有连接（垃圾桶图标）】**，或开启浏览器无痕窗口查询。

### 3. 如何辨别“真住宅家宽”与“机房云服务器”？
* 带宽显示在 **`30Mbps ~ 200Mbps`** 且人数较少（如 ≤10 人）的节点，大多为真实的日本 **SoftBank（软银）、NTT、KDDI** 或韩国 **KT、SK Broadband** 原生家庭宽带。
* 带宽显示为 **`1Gbps ~ 5Gbps`** 的超大带宽节点，通常为志愿者部署在 AWS（亚马逊云）、甲骨文云或机房中的服务器。
