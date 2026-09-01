/**
 * VPNGate to Mihomo (Clash Meta) OpenVPN Subscription Converter
 * Running on Cloudflare Workers
 * 
 * Features:
 * - Rich Node Naming (Country Flag, Bandwidth, Active Users, Latency, Host)
 * - Filtering & Sorting (by Speed, Active Users, Score, Country, Protocol)
 * - Cloudflare Edge Caching (caches.default)
 * - Token Authentication
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 路由与 Token 鉴权 (支持 ?token=xxx 或 直接 /TOKEN 路径)
    const AUTH_TOKEN = env.AUTH_TOKEN || "JJmi1vwutFHfssyH8Ym88NQNp2pZQ6Lo";
    
    // 优先从 ?token= 参数获取，如果没有则尝试从 URL 路径 /xxx 获取
    const pathToken = url.pathname.replace(/^\/+/, "").split("/")[0];
    const requestToken = url.searchParams.get("token") || (pathToken && pathToken !== "openvpn.yaml" ? pathToken : "");

    if (AUTH_TOKEN && requestToken !== AUTH_TOKEN) {
      return new Response("Unauthorized: 密钥错误或未提供。请在链接后添加 ?token=你的密钥 或 /你的密钥", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // 2. 检查 Cloudflare 边缘缓存 (基于完整 URL 缓存 1 小时)
    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.toString(), request);
    const cache = caches.default;

    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const hitHeaders = new Headers(cachedResponse.headers);
      hitHeaders.set("X-Cache-Status", "HIT");
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: hitHeaders,
      });
    }

    // 3. 读取用户查询参数（支持智能排序与高级过滤）
    const options = {
      proto: url.searchParams.get("proto") || "tcp", // 'tcp' | 'udp' | 'all'
      sort: url.searchParams.get("sort") || "speed", // 'speed' | 'users' | 'score' | 'ping'
      country: url.searchParams.get("country") || "", // 筛选国家，如 'JP' 或 'JP,KR'
      minSpeed: parseFloat(url.searchParams.get("min_speed") || "0"), // 最低带宽 (Mbps)
      maxUsers: parseInt(url.searchParams.get("max_users") || "999999", 10), // 最大当前连接人数
      limit: parseInt(url.searchParams.get("limit") || "80", 10), // 最大返回节点数
    };

    try {
      // 4. 获取并解析 VPNGate 节点
      const vpngateUrl = "https://www.vpngate.net/api/iphone/";
      const nodes = await fetchAndParseVPNGate(vpngateUrl, options);

      if (!nodes || nodes.length === 0) {
        return new Response("未匹配到符合条件的 VPNGate 节点，请尝试放宽过滤参数", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      // 5. 转换为 Mihomo 标准 YAML 格式
      const yamlData = dumpToYaml(nodes);

      // 6. 构建响应并存入 Cloudflare 边缘缓存
      const response = new Response(yamlData, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Content-Disposition": 'inline; filename="openvpn.yaml"',
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
          "X-Cache-Status": "MISS",
        },
      });

      // 异步存入缓存
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
 * 获取并解析 VPNGate CSV 数据
 */
async function fetchAndParseVPNGate(url, options) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    cf: {
      cacheTtl: 3600,
      cacheEverything: true,
    },
  });

  if (!res.ok) {
    throw new Error(`抓取 VPNGate 数据失败，状态码: ${res.status}`);
  }

  const text = await res.text();
  const lines = text.split(/\r?\n/);
  let rawNodes = [];

  const countryFilterSet = options.country
    ? new Set(options.country.toUpperCase().split(",").map((c) => c.trim()))
    : null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const record = line.split(",");
    if (!record || record.length < 15) continue;

    const firstCol = record[0].trim();
    if (firstCol.startsWith("#") || firstCol.startsWith("*")) {
      continue;
    }

    /*
      VPNGate CSV 字段索引定义:
      0: HostName
      1: IP
      2: Score
      3: Ping (ms)
      4: Speed (bps)
      5: CountryLong
      6: CountryShort
      7: NumVpnSessions (当前在线连接人数)
      8: Uptime (运行时间, 毫秒或秒)
      9: TotalUsers
      10: TotalTraffic
      14 (最后一位): OpenVPN_ConfigData_Base64
    */

    const hostName = record[0].trim();
    const ip = record[1].trim();
    const score = parseInt(record[2], 10) || 0;
    const ping = parseInt(record[3], 10) || 0;
    const speedBps = parseInt(record[4], 10) || 0;
    const speedMbps = Math.round((speedBps / (1000 * 1000)) * 10) / 10; // 转换为 Mbps
    const countryShort = (record[6] || "").trim().toUpperCase();
    const sessions = parseInt(record[7], 10) || 0;
    const uptimeMs = parseInt(record[8], 10) || 0;

    // 基础过滤
    if (hostName.includes("public")) continue;
    if (countryFilterSet && !countryFilterSet.has(countryShort)) continue;
    if (options.minSpeed > 0 && speedMbps < options.minSpeed) continue;
    if (sessions > options.maxUsers) continue;

    const lastCol = record[record.length - 1].trim();
    if (!lastCol) continue;

    let ovpnText = "";
    try {
      ovpnText = atob(lastCol);
    } catch (e) {
      continue;
    }

    // 格式化展示名称：例如 "🇯🇵 JP | 52.8M | 2人 | 4天 | vg12345"
    const flag = getFlagEmoji(countryShort);
    const speedStr = speedMbps >= 1000 ? `${(speedMbps / 1000).toFixed(1)}Gbps` : `${speedMbps}Mbps`;
    const uptimeStr = formatUptime(uptimeMs);
    const nodeName = `${flag} ${countryShort} | ${speedStr} | ${sessions}人 | ${uptimeStr} | ${hostName}`;

    const node = convertOvpnToMihomo(nodeName, ovpnText);
    if (!node || !node.server) continue;

    // 协议过滤
    if (options.proto === "tcp" && node.proto !== "tcp") {
      continue;
    } else if (options.proto === "udp" && node.proto !== "udp") {
      continue;
    }

    // 附加统计信息用于后续排序
    node._meta = {
      score,
      ping,
      speedMbps,
      sessions,
      uptimeMs,
    };

    rawNodes.push(node);
  }

  // 排序逻辑 (智能排序)
  if (options.sort === "speed") {
    // 按带宽从大到小排序
    rawNodes.sort((a, b) => b._meta.speedMbps - a._meta.speedMbps);
  } else if (options.sort === "users") {
    // 按当前连接人数从小到大排序 (人少优先)
    rawNodes.sort((a, b) => a._meta.sessions - b._meta.sessions);
  } else if (options.sort === "score") {
    // 按 VPNGate 综合评分从高到低排序
    rawNodes.sort((a, b) => b._meta.score - a._meta.score);
  } else if (options.sort === "ping") {
    // 按官方上报 Ping 从小到大排序
    rawNodes.sort((a, b) => a._meta.ping - b._meta.ping);
  }

  // 截取前 N 个高质量节点
  if (options.limit > 0 && rawNodes.length > options.limit) {
    rawNodes = rawNodes.slice(0, options.limit);
  }

  // 清除临时元数据，避免输出多余字段
  for (let n of rawNodes) {
    delete n._meta;
  }

  return rawNodes;
}

/**
 * 解析 .ovpn 文本并提取参数
 */
function convertOvpnToMihomo(name, ovpn) {
  const node = {
    name: name,
    type: "openvpn",
  };

  const lines = ovpn.split("\n");
  for (let line of lines) {
    line = line.trim();

    const matchRemote = line.match(/^\s*remote\s+([^\s]+)\s+(\d+)/i);
    if (matchRemote) {
      node.server = matchRemote[1];
      node.port = parseInt(matchRemote[2], 10);
    }

    const matchProto = line.match(/^\s*proto\s+(tcp|udp|tcp-client|udp-client)/i);
    if (matchProto) {
      if (matchProto[1].toLowerCase().startsWith("tcp")) {
        node.proto = "tcp";
      } else {
        node.proto = "udp";
      }
    }

    const matchCipher = line.match(/^\s*cipher\s+([^\s]+)/i);
    if (matchCipher) {
      node.cipher = matchCipher[1];
    }

    const matchAuth = line.match(/^\s*auth\s+([^\s]+)/i);
    if (matchAuth) {
      node.auth = matchAuth[1];
    }
  }

  const ca = extractXMLBlock(ovpn, "ca");
  if (ca) node.ca = ca;

  const cert = extractXMLBlock(ovpn, "cert");
  if (cert) node.cert = cert;

  const key = extractXMLBlock(ovpn, "key");
  if (key) node.key = key;

  if (!node.server) {
    return null;
  }
  if (!node.proto) {
    node.proto = "udp";
  }

  return node;
}

/**
 * 提取 XML 风格标签内容
 */
function extractXMLBlock(content, tag) {
  const regex = new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "i");
  const match = content.match(regex);
  if (match && match[1]) {
    return match[1].trim();
  }
  return "";
}

/**
 * 将国家代码转为 Emoji 国旗 (如 JP -> 🇯🇵)
 */
function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

/**
 * 格式化运行时间 (如 123456789ms -> "3天" 或 "5小时")
 */
function formatUptime(uptime) {
  if (!uptime || uptime <= 0) return "新上线";
  // VPNGate uptime 通常为毫秒或秒
  let seconds = uptime > 10000000 ? Math.floor(uptime / 1000) : uptime;
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}天`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}小时`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}分`;
}

/**
 * 手动将节点对象数组转为标准 Mihomo YAML 格式
 */
function dumpToYaml(nodes) {
  let yaml = "proxies:\n";
  for (const node of nodes) {
    yaml += `  - name: "${escapeYamlString(node.name)}"\n`;
    yaml += `    type: ${node.type}\n`;
    yaml += `    server: ${node.server}\n`;
    yaml += `    port: ${node.port}\n`;
    yaml += `    proto: ${node.proto}\n`;
    if (node.cipher) yaml += `    cipher: ${node.cipher}\n`;
    if (node.auth) yaml += `    auth: ${node.auth}\n`;

    // 针对长文本证书（ca/cert/key），采用 YAML 多行缩进写法 (|+ 格式)
    if (node.ca) yaml += `    ca: |+\n${indentText(node.ca, 6)}\n`;
    if (node.cert) yaml += `    cert: |+\n${indentText(node.cert, 6)}\n`;
    if (node.key) yaml += `    key: |+\n${indentText(node.key, 6)}\n`;
  }
  return yaml;
}

function escapeYamlString(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function indentText(text, spaces) {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
