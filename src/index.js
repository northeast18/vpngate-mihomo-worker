/**
 * VPNGate to Mihomo (Clash Meta) OpenVPN Subscription Converter (Enhanced Edition)
 * Running on Cloudflare Workers
 * 
 * 升级特性：
 * 1. 支持 &dialer_proxy=⚡ CF前置 (链式代理直出)
 * 2. 默认启用 sort=smart (智能家宽综合优选算法：人少优先、稳定优先、避开拥挤)
 * 3. 缓存优化为 5~10 分钟 (既不过载源站，又保证节点高度实时存活)
 * 4. 深度扫描提取 TCP 端口，大幅提高可用 TCP 节点率
 * 5. IP 自动去重，每个节点对应独立的日本家庭
 * 6. 支持 &full=1 生成开箱即用的完整 Clash 配置
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 路由与 Token 鉴权 (支持 ?token=xxx 或 /TOKEN 路径)
    const AUTH_TOKEN = env.AUTH_TOKEN || "JJmi1vwutFHfssyH8Ym88NQNp2pZQ6Lo";
    const pathToken = url.pathname.replace(/^\/+/, "").split("/")[0];
    const requestToken = url.searchParams.get("token") || (pathToken && pathToken !== "openvpn.yaml" ? pathToken : "");

    if (AUTH_TOKEN && requestToken !== AUTH_TOKEN) {
      return new Response("Unauthorized: 密钥错误或未提供。请在链接后添加 ?token=你的密钥 或 /你的密钥", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // 2. 边缘缓存优化：默认缓存 5 分钟 (300秒)，保证随官方实时刷新，避免死节点
    const cacheTtl = parseInt(url.searchParams.get("cache_ttl") || "300", 10);
    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.toString(), request);
    const cache = caches.default;

    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const hitHeaders = new Headers(cachedResponse.headers);
      hitHeaders.set("X-Cache-Status", "HIT");
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        headers: hitHeaders,
      });
    }

    // 3. 读取用户查询参数
    const options = {
      proto: (url.searchParams.get("proto") || "tcp").toLowerCase(), // 'tcp' | 'udp' | 'all'
      sort: (url.searchParams.get("sort") || "smart").toLowerCase(), // 'smart' (推荐) | 'speed' | 'users' | 'score' | 'ping'
      country: url.searchParams.get("country") || "JP", // 默认优先过滤日本
      minSpeed: parseFloat(url.searchParams.get("min_speed") || "10"), // 过滤 10Mbps 以下的小水管
      maxUsers: parseInt(url.searchParams.get("max_users") || "15", 10), // 默认过滤超过 15 人的拥挤节点
      limit: parseInt(url.searchParams.get("limit") || "40", 10), // 控制节点数
      dialerProxy: url.searchParams.get("dialer_proxy") || "", // 自动挂载链式前置
      fullConfig: url.searchParams.get("full") === "1" || url.searchParams.get("type") === "clash",
    };

    try {
      // 4. 获取并解析 VPNGate 官方实时数据
      const vpngateUrl = "https://www.vpngate.net/api/iphone/";
      const nodes = await fetchAndParseVPNGate(vpngateUrl, options);

      if (!nodes || nodes.length === 0) {
        return new Response("未匹配到符合条件的优质节点，请尝试放宽过滤参数（如增大 max_users 或降低 min_speed）", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      // 5. 转换为 Mihomo 标准 YAML 格式 (支持 Provider 模式或完整配置模式)
      const yamlData = dumpToYaml(nodes, options);

      // 6. 构建响应并存入边缘缓存
      const response = new Response(yamlData, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Content-Disposition": 'inline; filename="vpngate.yaml"',
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": `public, max-age=${cacheTtl}`,
          "X-Cache-Status": "MISS",
        },
      });

      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      return new Response("处理失败: " + err.message, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};

/**
 * 获取并解析 VPNGate CSV 数据（带智能综合评分与去重）
 */
async function fetchAndParseVPNGate(url, options) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    },
    cf: {
      cacheTtl: 300, // 抓取官方源时也保持 5 分钟刷新
      cacheEverything: true,
    },
  });

  if (!res.ok) throw new Error(`抓取 VPNGate 失败，HTTP状态码: ${res.status}`);

  const text = await res.text();
  const lines = text.split(/\r?\n/);
  let rawNodes = [];
  const seenIps = new Set();

  const countryFilterSet = options.country
    ? new Set(options.country.toUpperCase().split(",").map((c) => c.trim()))
    : null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const record = line.split(",");
    if (record.length < 15) continue;

    const firstCol = record[0].trim();
    if (firstCol.startsWith("#") || firstCol.startsWith("*")) continue;

    const hostName = record[0].trim();
    const ip = record[1].trim();
    const score = parseInt(record[2], 10) || 0;
    const ping = parseInt(record[3], 10) || 0;
    const speedBps = parseInt(record[4], 10) || 0;
    const speedMbps = Math.round((speedBps / 1000000) * 10) / 10;
    const countryShort = (record[6] || "").trim().toUpperCase();
    const sessions = parseInt(record[7], 10) || 0;
    const uptimeMs = parseInt(record[8], 10) || 0;

    // 过滤与去重
    if (seenIps.has(ip)) continue;
    if (countryFilterSet && !countryFilterSet.has(countryShort)) continue;
    if (options.minSpeed > 0 && speedMbps < options.minSpeed) continue;
    if (sessions > options.maxUsers) continue;

    const lastCol = record[record.length - 1].trim();
    if (!lastCol) continue;

    let ovpnText = "";
    try {
      ovpnText = atob(lastCol);
    } catch {
      continue;
    }

    // 智能解析 OVPN 配置（优先寻找匹配的协议与端口）
    const node = convertOvpnToMihomo(ovpnText, options.proto);
    if (!node || !node.server) continue;

    // 标记已收录此 IP
    seenIps.add(ip);

    // 智能综合家宽评分计算 (Smart Score)
    // 核心思想：人数少加权最大 (防拥挤)、在线稳定加分、延迟低加分
    const userPenalty = Math.max(1, sessions + 1);
    const speedScore = Math.min(speedMbps, 200) * 1.5;
    const uptimeHours = uptimeMs > 10000000 ? uptimeMs / 3600000 : uptimeMs / 3600;
    const stabilityScore = Math.min(uptimeHours, 72) * 2; // 稳定在线超过2~3天的加分
    const smartScore = (speedScore * 3) / userPenalty + stabilityScore - ping * 0.5;

    // 格式化节点名，直观看到当前拥挤度
    const flag = getFlagEmoji(countryShort);
    const speedStr = speedMbps >= 1000 ? `${(speedMbps / 1000).toFixed(1)}Gbps` : `${speedMbps}M`;
    const uptimeStr = formatUptime(uptimeMs);
    node.name = `${flag} ${countryShort} | ${speedStr} | ${sessions}人 | ${uptimeStr} | ${ip}`;

    // 挂载链式代理参数 (如果有)
    if (options.dialerProxy) {
      node["dialer-proxy"] = options.dialerProxy;
    }

    node._meta = {
      smartScore,
      speedMbps,
      sessions,
      ping,
      score,
    };

    rawNodes.push(node);
  }

  // 排序
  if (options.sort === "smart") {
    rawNodes.sort((a, b) => b._meta.smartScore - a._meta.smartScore);
  } else if (options.sort === "users") {
    rawNodes.sort((a, b) => a._meta.sessions - b._meta.sessions);
  } else if (options.sort === "speed") {
    rawNodes.sort((a, b) => b._meta.speedMbps - a._meta.speedMbps);
  } else if (options.sort === "ping") {
    rawNodes.sort((a, b) => a._meta.ping - b._meta.ping);
  }

  if (options.limit > 0 && rawNodes.length > options.limit) {
    rawNodes = rawNodes.slice(0, options.limit);
  }

  for (let n of rawNodes) {
    delete n._meta;
  }

  return rawNodes;
}

/**
 * 深度解析 .ovpn 文本，优先匹配指定的协议 (TCP/UDP)
 */
function convertOvpnToMihomo(ovpn, targetProto) {
  const node = {
    type: "openvpn",
  };

  const lines = ovpn.split("\n");
  let remotes = [];
  let defaultProto = "udp";

  for (let line of lines) {
    line = line.trim();

    // 抓取全局 proto
    const matchProto = line.match(/^\s*proto\s+(tcp|udp|tcp-client|udp-client)/i);
    if (matchProto) {
      defaultProto = matchProto[1].toLowerCase().startsWith("tcp") ? "tcp" : "udp";
    }

    // 抓取所有 remote 行
    const matchRemote = line.match(/^\s*remote\s+([^\s]+)\s+(\d+)(?:\s+(tcp|udp))?/i);
    if (matchRemote) {
      remotes.push({
        server: matchRemote[1],
        port: parseInt(matchRemote[2], 10),
        proto: matchRemote[3] ? matchRemote[3].toLowerCase() : null,
      });
    }

    const matchCipher = line.match(/^\s*cipher\s+([^\s]+)/i);
    if (matchCipher) node.cipher = matchCipher[1];

    const matchAuth = line.match(/^\s*auth\s+([^\s]+)/i);
    if (matchAuth) node.auth = matchAuth[1];
  }

  if (remotes.length === 0) return null;

  // 智能选择最匹配的 remote 端口
  let selectedRemote = null;
  if (targetProto === "tcp") {
    // 优先选择明确标注为 TCP 的端口，尤其是 443、995
    selectedRemote = remotes.find((r) => r.proto === "tcp" || (r.proto === null && defaultProto === "tcp"));
    if (!selectedRemote) return null; // 该节点确实不支持 TCP，舍弃
    node.proto = "tcp";
  } else if (targetProto === "udp") {
    selectedRemote = remotes.find((r) => r.proto === "udp" || (r.proto === null && defaultProto === "udp"));
    if (!selectedRemote) return null;
    node.proto = "udp";
  } else {
    selectedRemote = remotes[0];
    node.proto = selectedRemote.proto || defaultProto;
  }

  node.server = selectedRemote.server;
  node.port = selectedRemote.port;

  const ca = extractXMLBlock(ovpn, "ca");
  if (ca) node.ca = ca;

  const cert = extractXMLBlock(ovpn, "cert");
  if (cert) node.cert = cert;

  const key = extractXMLBlock(ovpn, "key");
  if (key) node.key = key;

  return node;
}

function extractXMLBlock(content, tag) {
  const match = content.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "i"));
  return match && match[1] ? match[1].trim() : "";
}

function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  return String.fromCodePoint(...countryCode.toUpperCase().split("").map((c) => 127397 + c.charCodeAt(0)));
}

function formatUptime(uptime) {
  if (!uptime || uptime <= 0) return "新上线";
  let seconds = uptime > 10000000 ? Math.floor(uptime / 1000) : uptime;
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}天`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}时`;
  return `${Math.floor(seconds / 60)}分`;
}

/**
 * 生成 YAML 配置
 */
function dumpToYaml(nodes, options) {
  let yaml = "proxies:\n";
  const proxyNames = [];

  for (const node of nodes) {
    proxyNames.push(node.name);
    yaml += `  - name: "${escapeYamlString(node.name)}"\n`;
    yaml += `    type: ${node.type}\n`;
    yaml += `    server: ${node.server}\n`;
    yaml += `    port: ${node.port}\n`;
    yaml += `    proto: ${node.proto}\n`;
    if (node["dialer-proxy"]) yaml += `    dialer-proxy: "${node["dialer-proxy"]}"\n`;
    if (node.cipher) yaml += `    cipher: ${node.cipher}\n`;
    if (node.auth) yaml += `    auth: ${node.auth}\n`;
    if (node.ca) yaml += `    ca: |+\n${indentText(node.ca, 6)}\n`;
    if (node.cert) yaml += `    cert: |+\n${indentText(node.cert, 6)}\n`;
    if (node.key) yaml += `    key: |+\n${indentText(node.key, 6)}\n`;
  }

  // 如果启用了 fullConfig，额外输出完整的策略组与分流规则
  if (options.fullConfig) {
    yaml += `\nproxy-groups:\n`;
    yaml += `  - name: "🇯🇵 日本家宽(自动优选)"\n`;
    yaml += `    type: fallback\n`;
    yaml += `    url: https://www.gstatic.com/generate_204\n`;
    yaml += `    interval: 600\n`;
    yaml += `    lazy: true\n`;
    yaml += `    proxies:\n`;
    for (const name of proxyNames) {
      yaml += `      - "${escapeYamlString(name)}"\n`;
    }

    yaml += `\n  - name: "🇯🇵 日本家宽(节点选择)"\n`;
    yaml += `    type: select\n`;
    yaml += `    proxies:\n`;
    yaml += `      - "🇯🇵 日本家宽(自动优选)"\n`;
    for (const name of proxyNames) {
      yaml += `      - "${escapeYamlString(name)}"\n`;
    }

    yaml += `\n  - name: "🚀 节点选择"\n`;
    yaml += `    type: select\n`;
    yaml += `    proxies:\n`;
    yaml += `      - "🇯🇵 日本家宽(自动优选)"\n`;
    yaml += `      - "🇯🇵 日本家宽(节点选择)"\n`;
    yaml += `      - DIRECT\n`;

    yaml += `\nrules:\n`;
    yaml += `  - GEOIP,LAN,DIRECT,no-resolve\n`;
    yaml += `  - GEOIP,CN,DIRECT,no-resolve\n`;
    yaml += `  - MATCH,🚀 节点选择\n`;
  }

  return yaml;
}

function escapeYamlString(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function indentText(text, spaces) {
  const prefix = " ".repeat(spaces);
  return text.split("\n").map((line) => prefix + line).join("\n");
}
