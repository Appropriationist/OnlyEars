'use strict';
/* ==========================================================================
   本地歌单（不需要登录任何平台）
   --------------------------------------------------------------------------
   为什么单独做：
     Mineradio 原有的 /api/playlist/* 全部绑定网易云账号，
     要登录、要 cookie、要联网。B站音源没有账号体系，
     所以这里做一个纯本地的歌单存储。

   存储：userData/local-playlists.json
     {
       "version": 1,
       "playlists": [
         { "id": "lp_xxx", "name": "周杰伦精选",
           "createdAt": 1795..., "updatedAt": 1795...,
           "songs": [ { bvid, cid, name, artist, cover, duration, ... } ] }
       ]
     }

   为什么用 JSON 而不是 SQLite：
     歌单规模小（几百首），JSON 足够，而且没有依赖、方便用户手动备份。
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let STORE_PATH = '';

function init(userDataDir) {
  STORE_PATH = path.join(userDataDir || process.cwd(), 'local-playlists.json');
  return STORE_PATH;
}

function storePath() {
  if (!STORE_PATH) init(process.env.MINERADIO_USER_DATA || process.cwd());
  return STORE_PATH;
}

function readStore() {
  const p = storePath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    if (!j || !Array.isArray(j.playlists)) return { version: 1, playlists: [] };
    return j;
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, playlists: [] };
    console.warn('[LocalPlaylist] 读取失败，按空处理:', e.message);
    return { version: 1, playlists: [] };
  }
}

function writeStore(data) {
  const p = storePath();
  const tmp = p + '.tmp';
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, p);   // 原子替换，避免写一半断电
    return true;
  } catch (e) {
    console.error('[LocalPlaylist] 写入失败:', e.message);
    try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

function newId() {
  return 'lp_' + crypto.randomBytes(6).toString('hex');
}

/* ---------------------------------------------------------------- 列表 */
function listPlaylists() {
  const s = readStore();
  return s.playlists.map(p => ({
    id: p.id,
    name: p.name,
    count: (p.songs || []).length,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    // 前三首封面，给前端做拼图预览
    covers: (p.songs || []).slice(0, 3).map(x => x.cover).filter(Boolean),
  }));
}

/* ---------------------------------------------------------------- 单张 */
function getPlaylist(id) {
  const s = readStore();
  return s.playlists.find(p => p.id === id) || null;
}

/* ---------------------------------------------------------------- 创建 */
function createPlaylist(name, songs) {
  const s = readStore();
  const now = Date.now();
  const pl = {
    id: newId(),
    name: String(name || '新建歌单').trim().slice(0, 60) || '新建歌单',
    createdAt: now,
    updatedAt: now,
    songs: normalizeSongs(songs),
  };
  s.playlists.unshift(pl);
  if (!writeStore(s)) throw new Error('写入失败');
  return pl;
}

/* ---------------------------------------------------------------- 改名 */
function renamePlaylist(id, name) {
  const s = readStore();
  const pl = s.playlists.find(p => p.id === id);
  if (!pl) return null;
  pl.name = String(name || pl.name).trim().slice(0, 60) || pl.name;
  pl.updatedAt = Date.now();
  writeStore(s);
  return pl;
}

/* ---------------------------------------------------------------- 删除 */
function deletePlaylist(id) {
  const s = readStore();
  const i = s.playlists.findIndex(p => p.id === id);
  if (i < 0) return false;
  s.playlists.splice(i, 1);
  return writeStore(s);
}

/* ---------------------------------------------------------------- 加歌 */
function addSongs(id, songs) {
  const s = readStore();
  const pl = s.playlists.find(p => p.id === id);
  if (!pl) return null;
  pl.songs = pl.songs || [];
  const seen = new Set(pl.songs.map(k => songKey(k)));
  for (const x of normalizeSongs(songs)) {
    const k = songKey(x);
    if (seen.has(k)) continue;
    seen.add(k);
    pl.songs.push(x);
  }
  pl.updatedAt = Date.now();
  writeStore(s);
  return pl;
}

/* ---------------------------------------------------------------- 删歌 */
/**
 * 从歌单移除一首。
 *
 * @param {string} id     歌单 id
 * @param {object} target 可以是 { bvid, cid } 也可以是 { name, artist }
 *                        没有 bvid 的曲目（精确搜索来的）必须用 name+artist 定位
 */
function removeSong(id, target) {
  const s = readStore();
  const pl = s.playlists.find(p => p.id === id);
  if (!pl) return null;

  target = target || {};
  const key = songKey(target);
  pl.songs = (pl.songs || []).filter(x => songKey(x) !== key);

  pl.updatedAt = Date.now();
  writeStore(s);
  return pl;
}

/* ---------------------------------------------------------------- 工具 */
/**
 * 歌曲的唯一键，用于去重。
 *
 * 优先级：
 *   1. 有 bvid → "bvid|cid"（最可靠，能区分同一首歌的不同音源）
 *   2. 无 bvid → "name|artist"（精确搜索来的曲库曲目没有 bvid，
 *      必须靠歌名+歌手区分，否则所有无 bvid 的歌会被当成同一首）
 */
function songKey(s) {
  s = s || {};
  const bvid = String(s.bvid || s.id || '').trim();
  if (bvid) return bvid + '|' + String(s.cid || 0);

  /* 没有 bvid：用歌名 + 歌手（归一化：去空格、小写、去括号内容） */
  const norm = (v) => String(v || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/\s+/g, '')
    .trim();

  const name = norm(s.name || s.title);
  const artist = norm(s.artist);
  if (name) return 'n:' + name + '|a:' + artist;

  /* 连歌名都没有：退化成随机键，避免误判为重复 */
  return 'u:' + Math.random().toString(36).slice(2) + '|' + Date.now();
}

function normalizeSongs(list) {
  if (!Array.isArray(list)) return [];
  return list.map(s => {
    s = s || {};
    return {
      bvid: String(s.bvid || s.id || ''),
      cid: Number(s.cid) || 0,
      name: String(s.name || s.title || '').slice(0, 200),
      artist: String(s.artist || s.author || '').slice(0, 120),
      album: String(s.album || '').slice(0, 120),
      cover: String(s.cover || s.picUrl || s.pic || '').slice(0, 500),
      duration: Number(s.duration) || 0,
      duration_s: Number(s.duration_s) || Math.round((Number(s.duration) || 0) / 1000),
      provider: 'bili',
      source: 'bili',
      addedAt: Number(s.addedAt) || Date.now(),
    };
  }).filter(x => x.bvid || x.name);
}

module.exports = {
  init,
  storePath,
  listPlaylists,
  getPlaylist,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addSongs,
  removeSong,
  removeByFileNames,
};

/* ==========================================================================
   按文件名清理歌单引用
   --------------------------------------------------------------------------
   场景：用户删除了下载的音频文件，歌单里还留着指向它的条目。
   这里按「文件名匹配」把所有歌单里的相关条目删掉。

   为什么按文件名而不是 bvid：
     下载的文件名形如「周杰伦 - 晴天.m4a」，
     歌单里存的是「歌名 + 歌手」，两者能对应上。
     而 bvid 在精确搜索加入歌单时可能是空的。
   ========================================================================== */

/**
 * 从所有歌单里移除文件名匹配的条目。
 *
 * @param {string[]} fileNames  文件名列表（含扩展名，如「周杰伦 - 晴天.m4a」）
 * @returns {object} { removed: 总删除数, playlists: 受影响的歌单数 }
 */
function removeByFileNames(fileNames) {
  if (!Array.isArray(fileNames) || !fileNames.length) {
    return { removed: 0, playlists: 0 };
  }

  // 归一化：去掉扩展名、空格、大小写
  const keys = new Set();
  for (const fn of fileNames) {
    const base = String(fn || '').replace(/\.(m4a|mp3|flac|wav|ogg)$/i, '');
    keys.add(normalizeMatchKey(base));
  }

  const s = readStore();
  let totalRemoved = 0;
  let affected = 0;

  for (const pl of s.playlists) {
    const before = (pl.songs || []).length;
    if (!before) continue;

    pl.songs = pl.songs.filter(song => {
      // 歌单里存的是「歌名」和「歌手」，拼成和文件名一样的格式来比对
      const candidates = [
        song.name && song.artist ? (song.artist + ' - ' + song.name) : '',
        song.name || '',
      ];
      for (const c of candidates) {
        if (c && keys.has(normalizeMatchKey(c))) return false;
      }
      return true;
    });

    const after = pl.songs.length;
    if (after < before) {
      totalRemoved += (before - after);
      affected++;
      pl.updatedAt = Date.now();
    }
  }

  if (totalRemoved > 0) writeStore(s);
  return { removed: totalRemoved, playlists: affected };
}

/** 归一化：去括号内容、去空格、小写 */
function normalizeMatchKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/\s+/g, '')
    .trim();
}