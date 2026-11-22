'use strict';
/* ==========================================================================
   本地播放历史
   --------------------------------------------------------------------------
   记录用户听过什么，支持：
     · 同曲去重（同一首歌的多个 B站音源版本合并成一条）
     · 每个去重组保留「所有播过的音源版本」，可切换默认
     · 一键清理

   存储：data/play-history.json
     {
       "version": 1,
       "items": [
         {
           "key": "归一化歌名|归一化歌手",     ← 去重键
           "name": "发如雪",
           "artist": "周杰伦",
           "album": "十一月的萧邦",
           "cover": "...",
           "duration": 299000,
           "playCount": 5,
           "lastPlayedAt": 1795...,
           "defaultBvid": "BV1xx",              ← 用户选的默认音源
           "sources": [                          ← 播过的所有音源版本
             { "bvid": "BV1xx", "title": "...", "author": "...", "score": 68,
               "playCount": 3, "lastPlayedAt": 1795... }
           ]
         }
       ]
     }

   为什么按「歌名+歌手」去重而不是 bvid：
     同一首歌在 B站可能有十几个视频（官方MV、4K修复、Hi-Res…），
     用户认知里那是「一首歌」，不是十几个。
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let STORE_PATH = '';
const MAX_ITEMS = 300;   // 最多保留 300 首（去重后）

function init(userDataDir) {
  STORE_PATH = path.join(userDataDir || process.cwd(), 'play-history.json');
  return STORE_PATH;
}

function storePath() {
  if (!STORE_PATH) init(process.env.MINERADIO_USER_DATA || process.cwd());
  return STORE_PATH;
}

function readStore() {
  const p = storePath();
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j || !Array.isArray(j.items)) return { version: 1, items: [] };
    return j;
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, items: [] };
    console.warn('[History] 读取失败:', e.message);
    return { version: 1, items: [] };
  }
}

function writeStore(data) {
  const p = storePath();
  const tmp = p + '.tmp';
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, p);
    return true;
  } catch (e) {
    console.error('[History] 写入失败:', e.message);
    try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

/* ---------------------------------------------------------------- 归一化 */
/**
 * 去重键：歌名 + 歌手，去掉括号内容（Live/伴奏/4K修复等版本标记）。
 *
 * "发如雪" / "发如雪 (Live)" / "【4K修复】发如雪" → 都归到 "发如雪"
 */
function normalizeKey(name, artist) {
  const clean = (s) => String(s || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[【】\[\]（）()]/g, '')
    .replace(/[\s·・,，。.!！?？'"“”‘’|\-_/]+/g, '')
    .trim();
  return clean(name) + '|' + clean(artist || '');
}

/* ---------------------------------------------------------------- 记录 */
/**
 * 记录一次播放。
 *
 * @param {object} p
 *   { name, artist, album, cover, duration, bvid, sourceTitle, sourceAuthor, score }
 * @returns {object} 更新后的条目
 */
function recordPlay(p) {
  p = p || {};
  const name = String(p.name || '').trim();
  if (!name) return null;

  const artist = String(p.artist || '').trim();
  const key = normalizeKey(name, artist);
  const now = Date.now();

  const s = readStore();
  let item = s.items.find(x => x.key === key);

  if (!item) {
    item = {
      key,
      name,
      artist,
      album: String(p.album || ''),
      cover: String(p.cover || ''),
      duration: Number(p.duration) || 0,
      playCount: 0,
      lastPlayedAt: now,
      defaultBvid: '',
      sources: [],
    };
    s.items.unshift(item);
  } else {
    // 更新元信息（歌手、封面可能变了）
    if (p.album) item.album = String(p.album);
    if (p.cover) item.cover = String(p.cover);
    if (p.duration) item.duration = Number(p.duration);
    item.lastPlayedAt = now;
    // 移到最前
    s.items = s.items.filter(x => x.key !== key);
    s.items.unshift(item);
  }

  item.playCount = (item.playCount || 0) + 1;

  /* 记录音源版本 */
  const bvid = String(p.bvid || '');
  if (bvid) {
    let src = item.sources.find(x => x.bvid === bvid);
    if (!src) {
      src = {
        bvid,
        title: String(p.sourceTitle || ''),
        author: String(p.sourceAuthor || ''),
        score: Number(p.score) || 0,
        playCount: 0,
        lastPlayedAt: now,
      };
      item.sources.push(src);
    }
    src.playCount = (src.playCount || 0) + 1;
    src.lastPlayedAt = now;
    if (p.sourceTitle) src.title = String(p.sourceTitle);
    if (p.score) src.score = Number(p.score);

    // 第一次播的自动成为默认
    if (!item.defaultBvid) item.defaultBvid = bvid;
  }

  // 限制总条数
  if (s.items.length > MAX_ITEMS) {
    s.items = s.items.slice(0, MAX_ITEMS);
  }

  writeStore(s);
  return item;
}

/* ---------------------------------------------------------------- 查询 */
function list(limit = 200, offset = 0) {
  const s = readStore();
  const items = s.items.slice(offset, offset + limit);
  return {
    items,
    total: s.items.length,
    offset,
    limit,
    hasMore: offset + items.length < s.items.length,
  };
}

function getOne(key) {
  const s = readStore();
  return s.items.find(x => x.key === key) || null;
}

/* ---------------------------------------------------------------- 修改 */
/** 设某一组的默认音源 */
function setDefaultSource(key, bvid) {
  const s = readStore();
  const item = s.items.find(x => x.key === key);
  if (!item) return null;
  const src = (item.sources || []).find(x => x.bvid === bvid);
  if (!src) return null;
  item.defaultBvid = bvid;
  if (src.title) item.cover = item.cover || '';
  writeStore(s);
  return item;
}

/** 从某一组里删掉一个音源版本 */
function removeSource(key, bvid) {
  const s = readStore();
  const item = s.items.find(x => x.key === key);
  if (!item) return null;
  item.sources = (item.sources || []).filter(x => x.bvid !== bvid);
  if (item.defaultBvid === bvid) {
    item.defaultBvid = item.sources.length ? item.sources[0].bvid : '';
  }
  writeStore(s);
  return item;
}

/** 删除一组（一整首歌） */
function removeItem(key) {
  const s = readStore();
  const before = s.items.length;
  s.items = s.items.filter(x => x.key !== key);
  writeStore(s);
  return before !== s.items.length;
}

/** 清空全部 */
function clearAll() {
  writeStore({ version: 1, items: [] });
  return true;
}

/** 统计 */
function stats() {
  const s = readStore();
  const totalPlays = s.items.reduce((n, x) => n + (x.playCount || 0), 0);
  const sourceCount = s.items.reduce((n, x) => n + (x.sources || []).length, 0);
  return {
    itemCount: s.items.length,
    totalPlays,
    sourceCount,
  };
}

module.exports = {
  init,
  storePath,
  recordPlay,
  list,
  getOne,
  setDefaultSource,
  removeSource,
  removeItem,
  clearAll,
  stats,
  normalizeKey,
};
