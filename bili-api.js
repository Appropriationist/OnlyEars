'use strict';
/* ==========================================================================
   哔哩哔哩音源（MVWeb 算法移植到 Node）
   --------------------------------------------------------------------------
   移植来源：本项目自研的 Python 版本（mvweb/bili.py + meta.py）
   逻辑一致，只换成 JS 实现。

   四件事：
     1. wbi 签名（搜索接口必需，否则 -412）
     2. 按「歌名+歌手+时长」打分排序，把翻唱/合集/鬼畜筛掉
     3. 只取 dash.audio[]，不碰视频轨（省 90% 带宽）
     4. 曲库搜索（QQ 音乐）+ 歌词匹配
   ========================================================================== */

const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const HEAD = {
  'User-Agent': UA,
  'Referer': 'https://www.bilibili.com/',
  'Origin': 'https://www.bilibili.com',
  'Accept': '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

// wbi 打乱表（固定 64 项）
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62,
  11, 36, 20, 34, 44, 52,
];

const kcache = { exp: 0, v: null };

/* ---------------------------------------------------------------- HTTP 工具 */
/**
 * 通用 JSON 请求。
 *
 * 注意 headers 的合并顺序：传入的 headers 要**覆盖**默认的 B 站头。
 * 之前踩过：QQ 音乐的请求带上了 B 站 Referer/Origin，接口返回空数据。
 */
async function getJSON(url, { headers = {}, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { ...HEAD, ...headers },
      signal: ctl.signal,
      redirect: 'follow',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 非 B 站的请求：不带任何 B 站头，只带指定的 UA/Referer。
 * QQ 音乐、网易云这类接口对 Referer 敏感，混用会返回空。
 */
async function getJSONPlain(url, { headers = {}, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...headers,
      },
      signal: ctl.signal,
      redirect: 'follow',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    return JSON.parse(txt);
  } finally {
    clearTimeout(timer);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- wbi 签名 */
/**
 * 取 wbi 打乱表（缓存 1 小时）。
 * 必须带重试：这是所有搜索/取流的前置依赖，一次网络抖动就全挂。
 * 实测 B 站 nav 接口偶发超时。
 */
async function mixinKey() {
  if (Date.now() / 1000 < kcache.exp && kcache.v) return kcache.v;

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const j = await getJSON('https://api.bilibili.com/x/web-interface/nav');
      const d = (j.data || {}).wbi_img || {};
      const img = (d.img_url || '').split('/').pop().split('.')[0];
      const sub = (d.sub_url || '').split('/').pop().split('.')[0];
      const raw = img + sub;
      if (raw.length < 64) throw new Error('wbi key 格式异常（可能被风控）');
      kcache.v = MIXIN_TAB.map(i => raw[i]).join('').slice(0, 32);
      kcache.exp = Date.now() / 1000 + 3600;
      return kcache.v;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(600 * (attempt + 1));
    }
  }
  // 三次都失败：还有旧 key 就凑合用（多半还没真失效）
  if (kcache.v) return kcache.v;
  throw new Error(`wbi key 获取失败（重试 3 次）: ${lastErr && lastErr.message}`);
}

function signRaw(params, key) {
  const p = { ...params, wts: Math.floor(Date.now() / 1000) };
  // 参数按 key 排序后 urlencode，再过滤 !'()*
  const q = Object.keys(p).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`)
    .join('&')
    .replace(/[!'()*]/g, '');
  p.w_rid = crypto.createHash('md5').update(q + key).digest('hex');
  return p;
}

async function sign(params) {
  const key = await mixinKey();
  return signRaw(params, key);
}

function qs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/* ---------------------------------------------------------------- 工具 */
function parseDuration(s) {
  let n = 0;
  for (const x of String(s || '0:00').split(':')) {
    const v = parseFloat(x);
    if (!Number.isNaN(v)) n = n * 60 + Math.floor(v);
  }
  return n;
}

const BLACK = /翻唱|翻自|cover|伴奏|纯音乐|钢琴|吉他|dj|remix|鬼畜|循环|合集|串烧|加速|慢速|降调|升调|变调|reaction|教学|教程|直播|切片|花絮|采访|混剪|铃声|闹钟|karaoke|卡拉ok|清唱|现场|live|演唱会|片段|试听|合辑|精选|top\d|排行|歌单|musi?c\s*box|八音盒|口琴|小提琴|古筝|联唱|对唱|伴奏带|和声|demo|预告|剪辑|混音/i;

const WHITE = /官方|mv|official|高清|无损|高音质|1080p|4k|hires|原版|正式版|audio|lyric|歌词|专辑|album|原曲/i;

const TID_MV = 193;
const TID_MUSIC = 3;
const TID_NOISE = new Set([1, 4, 5, 17, 71, 138, 160, 119, 155, 156, 188, 202, 211]);

function fmtPlay(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}

/* ---------------------------------------------------------------- 搜索 */
async function search(keyword, page = 1) {
  let p;
  try {
    p = await sign({ search_type: 'video', keyword, page });
  } catch {
    return [];
  }
  let j;
  try {
    j = await getJSONPlain('https://api.bilibili.com/x/web-interface/wbi/search/type?' + qs(p));
  } catch {
    return [];
  }
  if (j.code !== 0) return [];

  const out = [];
  for (const it of (j.data && j.data.result) || []) {
    if (!it.bvid) continue;
    let pic = it.pic || '';
    if (pic.startsWith('//')) pic = 'https:' + pic;
    out.push({
      bvid: it.bvid,
      title: String(it.title || '').replace(/<[^>]+>/g, ''),
      author: it.author || '',
      mid: it.mid,
      secs: parseDuration(it.duration),
      tid: it.typeid,
      play: it.play || 0,
      pic,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- 打分 */
const OFFICIAL = {};   // 歌手官方号 mid，key 用小写作者名（可扩充）

function normArtist(s) {
  return String(s || '').trim().toLowerCase();
}

function scoreOne(c, target) {
  let s = 0;
  const why = [];
  const d = c.secs;
  const t = (target && target > 1) ? target : 0;
  const r = t ? d / t : 0;

  if (t) {
    if (r >= 0.985 && r <= 1.015) {
      s += 50; why.push('时长精确');
    } else if (Math.abs(d - t) <= Math.max(6, t * 0.02)) {
      s += 30; why.push('时长接近');
    } else if (d - t > 0 && d - t <= 45) {
      s += 10; why.push('MV前奏');
    } else {
      s -= 40; why.push(`偏离${r.toFixed(2)}x`);
    }

    for (const r0 of [0.9, 0.95, 1.05, 1.1, 1.25]) {
      if (Math.abs(r - r0) < 0.008) {
        s += 15; why.push(`变速${r0}x`);
        break;
      }
    }

    if (d > t * 1.6 || d < t * 0.55) {
      s -= 60; why.push('非单曲');
    }
  }

  if (d > 3600) { s -= 100; why.push('超长'); }

  const m = c.title.match(BLACK);
  if (m) { s -= 40; why.push(`黑名单「${m[0]}」`); }
  if (WHITE.test(c.title)) { s += 12; why.push('白名单'); }

  if (c.tid === TID_MV) { s += 25; why.push('MV区'); }
  else if (c.tid === TID_MUSIC) { s += 8; why.push('音乐区'); }
  else if (TID_NOISE.has(c.tid)) { s -= 20; why.push('无关分区'); }

  if (c.play > 1000000) { s += 6; why.push('高播放'); }

  const off = OFFICIAL[normArtist(c.author)];
  if (c.mid && off && c.mid === off) { s += 30; why.push('官方UP'); }

  return [Math.round(s * 10) / 10, why];
}

/* ---------------------------------------------------------------- 候选池 */
/**
 * 多关键词搜索 + 去重 + 打分，按分数降序。
 *
 * mode 控制「发几次搜索」——这是速度的第一大来源：
 *   fast     1 次（歌名+歌手），最快
 *   balanced 2 次（基础 + 官方），默认
 *   best     5 次（基础/官方/MV/音频/无损），最全
 *
 * 实测（2026-11，热门歌）：
 *   fast ~0.4s   balanced ~0.9s   best ~2.1s
 */
async function candidates(title, artist = '', durationS = 0, opts = {}) {
  const mode = opts.mode || 'balanced';
  const pages = opts.pages || 1;
  const extra = opts.extraKeyword || '';

  const base = artist ? `${artist} ${title}` : title;
  let kws;
  if (mode === 'fast') kws = [base];
  else if (mode === 'best') {
    kws = [base, `${title} 官方`, `${title} MV`, `${artist} ${title} 音频`, `${title} 无损`];
  } else kws = [base, `${title} 官方`];

  if (extra) kws.unshift(extra);

  // 并发发出
  const batches = await Promise.all(
    kws.map(kw => searchKeyword(kw, pages).catch(() => []))
  );

  const seen = new Set();
  const out = [];
  for (let i = 0; i < kws.length; i++) {
    for (const c of batches[i] || []) {
      if (seen.has(c.bvid)) continue;
      seen.add(c.bvid);
      const [sc, why] = scoreOne(c, durationS);
      c.score = sc;
      c.why = why;
      c.delta = durationS ? Math.round((c.secs - durationS) * 10) / 10 : null;
      c.kw = kws[i];
      out.push(c);
    }
  }

  out.sort((a, b) => (b.score - a.score) || ((b.play || 0) - (a.play || 0)));
  return out;
}

async function searchKeyword(kw, pages) {
  const res = await Promise.all(
    Array.from({ length: pages }, (_, i) => search(kw, i + 1).catch(() => []))
  );
  return res.flat();
}

/* ---------------------------------------------------------------- 分P / 合集 */
/**
 * 取一个视频的分P列表。
 *
 * B 站有两种多集结构：
 *   1) pages[]     —— 多P视频（1P/2P/3P…），同一个 bvid，cid 不同
 *   2) ugc_season  —— 合集，每集是独立 bvid
 */
async function partsOf(bvid) {
  let v;
  try {
    v = await getJSON('https://api.bilibili.com/x/web-interface/view?' + qs({ bvid }));
  } catch (e) {
    throw new Error('view 请求失败: ' + e.message);
  }
  if (v.code !== 0) throw new Error('view 失败: ' + (v.message || v.code));

  const data = v.data || {};
  const title = data.title || '';
  const owner = (data.owner || {}).name || '';
  const cover = data.pic || '';
  const pages = data.pages || [];

  // 合集
  const season = data.ugc_season || {};
  const sections = season.sections || [];
  if (sections.length) {
    const items = [];
    let idx = 0;
    for (const sec of sections) {
      for (const ep of sec.episodes || []) {
        idx++;
        const arc = ep.arc || {};
        items.push({
          index: idx,
          cid: arc.cid || ep.cid || 0,
          bvid: ep.bvid || arc.bvid || '',
          title: ep.title || arc.title || `第 ${idx} 集`,
          duration: Math.floor(arc.duration || 0),
          pic: ep.pic || arc.pic || cover,
        });
      }
    }
    if (items.length > 1) {
      return { kind: 'season', title: season.title || title, owner, bvid, items };
    }
  }

  // 多P
  if (pages.length > 1) {
    const items = pages.map((p, i) => ({
      index: Math.floor(p.page || i + 1),
      cid: p.cid || 0,
      bvid,
      title: p.part || `P${i + 1}`,
      duration: Math.floor(p.duration || 0),
      pic: cover,
    }));
    return { kind: 'parts', title, owner, bvid, items };
  }

  // 单个
  const cid = pages.length ? pages[0].cid : (data.cid || 0);
  return {
    kind: 'single', title, owner, bvid,
    items: [{
      index: 1, cid, bvid, title,
      duration: Math.floor(data.duration || 0),
      pic: cover,
    }],
  };
}

/* ---------------------------------------------------------------- 取音轨 */
/**
 * 拿最高码率 DASH 音轨直链。
 * cid=0 时取第一个分P；多P必须指定 cid。
 */
async function audioOf(bvid, cid = 0) {
  const v = await getJSON('https://api.bilibili.com/x/web-interface/view?' + qs({ bvid }));
  if (v.code !== 0) throw new Error('view 失败: ' + (v.message || v.code));

  const data = v.data || {};
  const pages = data.pages || [];

  if (!cid) cid = data.cid;

  // 分P标题 + 该P自己的时长（多P视频的 data.duration 是总长，
  // 直接用会让播放栏显示 6:59:02 这种数字）
  let pageTitle = '', pageNo = 0, pageDur = 0;
  for (const p of pages) {
    if (p.cid === cid) {
      pageTitle = p.part || '';
      pageNo = Math.floor(p.page || 0);
      pageDur = Math.floor(p.duration || 0);
      break;
    }
  }

  const p = await sign({
    bvid, cid,
    fnval: 16,     // DASH
    fnver: 0,
    fourk: 1,
    platform: 'pc',
  });

  const pu = await getJSON('https://api.bilibili.com/x/player/wbi/playurl?' + qs(p));
  if (pu.code !== 0) throw new Error('playurl 失败: ' + (pu.message || pu.code));

  const dash = (pu.data || {}).dash || {};
  let best = null, bestBw = -1;

  // 大会员才有的 FLAC / 杜比，有就用
  for (const key of ['flac', 'dolby']) {
    const a = (dash[key] || {}).audio;
    if (a && a.baseUrl) { best = a; bestBw = a.bandwidth || 1000000; break; }
  }
  if (!best) {
    for (const a of dash.audio || []) {
      const bw = a.bandwidth || 0;
      if (bw > bestBw) { best = a; bestBw = bw; }
    }
  }
  if (!best) throw new Error('该视频没有 DASH 音轨（可能是 PGC / 付费内容）');

  return {
    url: best.baseUrl || best.base_url,
    backup: best.backupUrl || best.backup_url || [],
    bandwidth: bestBw,
    codecs: best.codecs || '',
    mime: best.mimeType || best.mime_type || 'audio/mp4',
    expire: Math.floor(Date.now() / 1000) + 6400,
    duration: pageDur || data.duration,
    title: data.title,
    owner: (data.owner || {}).name,
    cid,
    page_no: pageNo,
    page_title: pageTitle,
    page_count: pages.length,
  };
}

/* ---------------------------------------------------------------- 曲库搜索（QQ 音乐） */
function coverUrl(albumMid, size = 500) {
  if (!albumMid) return '';
  return `https://y.qq.com/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg`;
}

async function songSearch(keyword, limit = 20, page = 1) {
  const kw = String(keyword || '').trim();
  if (!kw) return [];

  const params = {
    w: kw,
    format: 'json',
    n: Math.max(1, Math.min(limit, 50)),
    p: Math.max(1, page),
    cr: 1,
    new_json: 1,
    t: 0,
  };
  let j;
  try {
    j = await getJSONPlain(
      'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?' + qs(params),
      { headers: { Referer: 'https://y.qq.com/' } }
    );
  } catch {
    return [];
  }

  const raw = (j.data || {}).song || {};
  const songs = raw.list || [];
  const out = [];
  for (const s of songs) {
    try {
      const artist = (s.singer || [])
        .map(x => x.name || '').filter(Boolean).join(' / ');
      const alb = s.album || {};
      const dur = Math.floor(s.interval || 0);
      out.push({
        title: String(s.title || '').trim(),
        artist,
        album: String(alb.name || '').trim(),
        duration_s: dur,
        cover: coverUrl(alb.mid || ''),
        mid: s.mid || '',
        provider: 'bili',
        source: 'bili',
      });
    } catch { /* skip */ }
  }
  return out.filter(x => x.title && x.duration_s > 0);
}

/* ---------------------------------------------------------------- 歌词 */
async function lyric(title, artist = '', durationS = 0) {
  const kw = `${title} ${artist}`.trim();
  if (!kw) return { found: false, lines: [] };

  // 1. 先在曲库里找最匹配的一首，拿它的 songmid
  let mid = '';
  try {
    const list = await songSearch(kw, 10, 1);
    if (list.length) {
      // 打分：歌名一致 +30，歌手包含 +20，时长接近 +20
      let best = null, bestScore = -1e9;
      for (const x of list) {
        let sc = 0;
        if (x.title === title) sc += 30;
        else if (x.title.includes(title) || title.includes(x.title)) sc += 15;
        if (artist && x.artist.includes(artist)) sc += 20;
        if (durationS > 0) {
          const d = Math.abs(x.duration_s - durationS);
          if (d <= 2) sc += 20;
          else if (d <= 5) sc += 10;
          else if (d > 15) sc -= 20;
        }
        if (sc > bestScore) { bestScore = sc; best = x; }
      }
      if (best && bestScore >= 40) mid = best.mid;
    }
  } catch { /* 曲库失败就跳过 */ }

  if (!mid) return { found: false, lines: [] };

  // 2. 拿歌词
  try {
    const j = await getJSONPlain(
      'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?' + qs({
        songmid: mid, format: 'json', nobase64: 1, g_tk: 5381,
      }),
      { headers: { Referer: 'https://y.qq.com/portal/player.html' } }
    );
    let text = j.lyric || '';
    if (j.retcode !== 0 || !text) return { found: false, lines: [] };
    // 有些返回是 base64
    if (!/^\[/.test(text)) {
      try { text = Buffer.from(text, 'base64').toString('utf8'); } catch { /* keep */ }
    }
    /* 同时给两种格式：
         lines —— [{t, s}]，我们自己用（壁纸页面）
         lyric —— 原始 LRC 文本，Mineradio 前端的 parser 要这个
       它的 parseLyricResponseToOriginalState 读 response.lyric 再解析，
       只给 lines 数组它认不出来（表现为「没有歌词」）。 */
    return {
      found: true,
      lines: parseLrc(text),
      lyric: text,
      mid,
      source: 'qq',
    };
  } catch {
    return { found: false, lines: [] };
  }
}

/** LRC → [{t: 秒, s: 文本}] */
function parseLrc(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  // [mm:ss.xx] 或 [mm:ss:xx]，一行可能带多个时间标签
  const tag = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lines) {
    const tags = [];
    let m;
    tag.lastIndex = 0;
    while ((m = tag.exec(raw)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      let frac = m[3] ? parseInt(m[3], 10) : 0;
      const len = m[3] ? m[3].length : 0;
      if (len === 2) frac *= 10;
      else if (len === 1) frac *= 100;
      tags.push(min * 60 + sec + frac / 1000);
    }
    if (!tags.length) continue;
    const body = raw.replace(tag, '').trim();
    if (!body) continue;
    for (const t of tags) out.push({ t: Math.round(t * 1000) / 1000, s: body });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/* ---------------------------------------------------------------- 评论 */
/**
 * 取一个视频的评论（B 站公开接口，不需要登录）。
 *
 * /x/v2/reply 返回结构：
 *   data.replies[]  { rpid, member:{uname, avatar}, content:{message},
 *                     like, ctime, rcount }
 *
 * 返回统一结构，方便前端直接渲染：
 *   [{ user, avatar, text, like, time, replies }]
 */
async function comments(bvid, limit = 18) {
  if (!bvid) return [];

  // 需要 aid（AV 号），先查 bvid → aid
  let aid = 0;
  try {
    const v = await getJSON('https://api.bilibili.com/x/web-interface/view?' + qs({ bvid }));
    if (v.code === 0 && v.data) aid = v.data.aid || 0;
  } catch { /* 拿不到就用 0，接口会失败 */ }
  if (!aid) return [];

  let j;
  try {
    j = await getJSON(
      'https://api.bilibili.com/x/v2/reply?' + qs({
        type: 1,
        oid: aid,
        sort: 2,               // 2 = 按热度
        ps: Math.max(1, Math.min(limit, 49)),
        pn: 1,
      })
    );
  } catch {
    return [];
  }
  if (j.code !== 0) return [];

  const replies = (j.data && j.data.replies) || [];
  /* 返回格式要和 Mineradio 的 renderDetailComments 对齐：
       { user: { nickname, avatar }, content, likedCount, time }
     它读 user.nickname / user.avatar / content / likedCount，
     不是 user 字符串 + text。之前格式错了，界面显示成"音乐用户"+空内容。 */
  return replies.map(r => {
    const m = r.member || {};
    return {
      id: String(r.rpid || ''),
      user: {
        nickname: m.uname || 'B站用户',
        avatar: m.avatar || '',
        mid: String(m.mid || ''),
      },
      content: (r.content && r.content.message) || '',
      likedCount: Number(r.like) || 0,
      time: Number(r.ctime) || 0,
      replyCount: Number(r.rcount) || 0,
    };
  });
}


/* ==========================================================================
   每日电台
   --------------------------------------------------------------------------
   B站没有"电台"接口，但音乐区搜索有大量官方 MV / Hi-Res 单曲。

   做法：
     1. 用日期做随机种子，每天从关键词池抽 6 个（同一天结果固定）
     2. 每个关键词搜一次（按播放量排序，时长 1-10 分钟）
     3. 过滤掉非音乐内容（跳舞/片段/剪辑/盘点/解说…）
     4. 要求标题带音乐标识（官方/MV/Hi-Res/主题曲…）
     5. 同一个 UP 主最多留 2 首
     6. 按播放量排序

   为什么不用排行榜接口：
     /x/web-interface/ranking/v2 有风控（code -352），
     而且音乐区排行混了很多短视频和合集。
   ========================================================================== */

const RADIO_KEYWORDS = [
  '华语流行', '欧美流行', '粤语歌', '日语歌', '韩语歌',
  '纯音乐', '钢琴曲', '民谣', '摇滚', '说唱',
  'R&B', '古风', '电子音乐', '爵士', '乡村音乐',
  '经典老歌', '90年代金曲', '00年代金曲', '影视原声', '动漫音乐',
];

const RADIO_BLACK = /跳舞|激情|吻|片段|采访|花絮|预告|解说|reaction|盘点|混剪|串烧|教学|教程|搞笑|鬼畜|音效|特效|整活|农村|恶搞|沙雕|原声片段|影视剪辑/i;

const RADIO_WHITE = /官方\s*MV|官方音乐|MV|Hi-?Res|无损|专辑|单曲|主题曲|片头曲|片尾曲|OST|录音室|原唱|金曲|经典|钢琴|演奏|official/i;

function dailyRandom(seed) {
  let s = Math.abs(seed) % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function pickN(arr, n, rnd) {
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(rnd() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

async function radioSearchOne(keyword, page) {
  const params = {
    search_type: 'video',
    keyword,
    order: 'click',
    duration: 1,
    page: String(page || 1),
  };
  const signed = await sign(params);
  let j;
  try {
    j = await getJSONPlain('https://api.bilibili.com/x/web-interface/wbi/search/type?' + qs(signed));
  } catch (e) {
    console.warn('[Radio] 搜索失败:', keyword, e.message);
    return [];
  }
  if (!j || j.code !== 0) {
    console.warn('[Radio] 接口异常:', keyword, j && j.code);
    return [];
  }
  const list = (j && j.data && j.data.result) || [];
  const out = [];
  for (const it of list) {
    const title = String(it.title || '').replace(/<[^>]+>/g, '');
    const bvid = String(it.bvid || '');
    if (!bvid || !/^BV[0-9A-Za-z]{10}$/.test(bvid)) continue;

    const seconds = parseDuration(it.duration);
    if (seconds < 90 || seconds > 480) continue;
    if (RADIO_BLACK.test(title)) continue;
    if (!RADIO_WHITE.test(title)) continue;

    let cover = String(it.pic || '');
    if (cover.startsWith('//')) cover = 'https:' + cover;

    out.push({
      bvid,
      name: title,
      artist: String(it.author || ''),
      cover,
      duration: seconds * 1000,
      play: Number(it.play) || 0,
      keyword,
    });
  }
  return out;
}

/* 批量检查视频是否是多P / 合集单集
   --------------------------------------------------------------------------
   搜索接口不返回 videos 字段，必须逐个查 view 接口。
   并发查，10 个约 260ms，可接受。

   返回 Map<bvid, { videos, aid, isSeason }>
   · videos > 1  → 多P，跳过（通常是合集/演唱会）
   · isSeason    → 属于某个合集（单集仍可播，但标注出来）
   ========================================================================== */
async function checkMultiPart(bvids) {
  const out = new Map();
  if (!Array.isArray(bvids) || !bvids.length) return out;

  const HEAD_VIEW = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
  };

  await Promise.all(bvids.map(async (bv) => {
    try {
      const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bv, {
        headers: HEAD_VIEW,
      });
      if (!r.ok) return;
      const j = await r.json();
      const d = (j && j.data) || {};
      out.set(bv, {
        videos: Number(d.videos) || 1,
        aid: d.aid || 0,
        isSeason: !!d.ugc_season,
        seasonTitle: d.ugc_season ? String(d.ugc_season.title || '') : '',
      });
    } catch (e) {
      /* 查不到就当它正常，不阻塞 */
    }
  }));

  return out;
}

async function dailyRadio(opts) {
  opts = opts || {};
  const limit = Math.max(10, Math.min(60, Number(opts.limit) || 30));
  let seed = Number(opts.dateSeed);
  if (!seed) {
    const d = new Date();
    seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  const rnd = dailyRandom(seed);
  const keywords = pickN(RADIO_KEYWORDS, 6, rnd);

  const results = await Promise.all(
    keywords.map(function (k) {
      return radioSearchOne(k).catch(function () { return []; });
    })
  );

  const all = [].concat.apply([], results);
  if (!all.length) return { date: seed, keywords, songs: [] };

  all.sort(function (a, b) { return b.play - a.play; });

  /* 检查多P：多P通常是合集/演唱会，不是单曲，跳过。
     只查前 40 个候选，避免请求过多。 */
  const checkList = all.slice(0, 40).map(function (x) { return x.bvid; });
  const mpMap = await checkMultiPart(checkList);
  const singleOnly = all.filter(function (x) {
    const info = mpMap.get(x.bvid);
    if (!info) return true;              // 查不到就放行
    return info.videos <= 1;             // 只要单P
  });
  all.length = 0;
  Array.prototype.push.apply(all, singleOnly);

  const seenBv = new Set();
  const byAuthor = new Map();
  const final = [];

  for (const s of all) {
    if (seenBv.has(s.bvid)) continue;
    const cnt = byAuthor.get(s.artist) || 0;
    if (cnt >= 2) continue;
    seenBv.add(s.bvid);
    byAuthor.set(s.artist, cnt + 1);
    final.push(s);
    if (final.length >= limit) break;
  }

  return { date: seed, keywords, songs: final };
}


/* ==========================================================================
   电台续播：换一个日期种子再生成一批
   --------------------------------------------------------------------------
   用户听完 21 首还想听 → 用「今天日期 + 偏移量」当种子再生一批。
   这样：
     · 第一批是今天的
     · 第二批是"明天"的（种子+1）
     · 第三批是"后天"的
     · 可以一直续下去，且每批不重复（关键词组合不同）

   同时排除已经播过的 bvid，保证不重样。
   ========================================================================== */

async function radioNextBatch(opts) {
  opts = opts || {};
  const limit = Math.max(10, Math.min(60, Number(opts.limit) || 30));
  const exclude = new Set(Array.isArray(opts.exclude) ? opts.exclude : []);

  let baseSeed = Number(opts.dateSeed);
  if (!baseSeed) {
    const d = new Date();
    baseSeed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /* 往后推 N 天，最多试 7 次（避免无限循环） */
  const offsetStart = Number(opts.offset) || 1;
  for (let k = 0; k < 7; k++) {
    const seed = baseSeed + offsetStart + k;
    const r = await dailyRadio({ limit, dateSeed: seed });
    const fresh = (r.songs || []).filter(function (s) { return !exclude.has(s.bvid); });
    if (fresh.length >= 5) {
      return { date: seed, keywords: r.keywords, songs: fresh, offset: offsetStart + k };
    }
  }

  return { date: baseSeed, keywords: [], songs: [], offset: offsetStart };
}
module.exports = {
  search,
  candidates,
  partsOf,
  audioOf,
  songSearch,
  lyric,
  comments,
  parseLrc,
  fmtPlay,
  coverUrl,
  dailyRadio,
  radioNextBatch,
  // 调试用
  _internals: { mixinKey, sign, scoreOne, parseDuration },
};
