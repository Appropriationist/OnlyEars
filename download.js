'use strict';
/* ==========================================================================
   下载模块
   --------------------------------------------------------------------------
   支持两种格式：
     m4a —— 直接存 B站的原始音轨（不转码，体积零增加，音质不降）
     mp3 —— 用 ffmpeg 转码（需要 ffmpeg，转码会有轻微损失）

   为什么默认 m4a：
     B站音轨本身就是 AAC/m4a。存 m4a 等于把原始数据落盘，
     不转码 = 不降质 + 不耗 CPU + 速度快。所有主流播放器都支持 m4a。

   为什么还提供 mp3：
     有些人要在老设备（车载、老 MP3 播放器）上放，那些只认 mp3。

   ffmpeg 查找顺序：
     1. 环境变量 MINERADIO_FFMPEG
     2. 程序目录下的 ffmpeg.exe
     3. 系统 PATH
     4. 同目录 data/ffmpeg.exe
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

let DOWNLOAD_DIR = '';
let SETTINGS_PATH = '';

/* ---------------------------------------------------------------- 初始化 */
function init(userDataDir) {
  const dir = userDataDir || process.cwd();
  SETTINGS_PATH = path.join(dir, 'download-settings.json');

  const s = readSettings();
  DOWNLOAD_DIR = s.dir || path.join(os.homedir(), 'Music', 'Mineradio');
  try { fs.mkdirSync(DOWNLOAD_DIR, { recursive: true }); } catch (_) {}
  return { dir: DOWNLOAD_DIR, settingsPath: SETTINGS_PATH };
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeSettings(patch) {
  const cur = readSettings();
  const next = Object.assign({}, cur, patch);
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Download] 设置保存失败', e.message);
  }
  if (patch.dir) {
    DOWNLOAD_DIR = patch.dir;
    try { fs.mkdirSync(DOWNLOAD_DIR, { recursive: true }); } catch (_) {}
  }
  return next;
}

function getSettings() {
  const s = readSettings();
  return {
    dir: s.dir || DOWNLOAD_DIR,
    format: s.format === 'mp3' ? 'mp3' : 'm4a',
    ffmpeg: findFFmpeg() || '',
    ffmpegAvailable: !!findFFmpeg(),
  };
}

/* ---------------------------------------------------------------- ffmpeg */
let _ffmpegCache = null;
function findFFmpeg() {
  if (_ffmpegCache) return _ffmpegCache;

  const cands = [];
  if (process.env.MINERADIO_FFMPEG) cands.push(process.env.MINERADIO_FFMPEG);
  // 程序目录（resources/app 的上级）
  cands.push(path.join(__dirname, 'ffmpeg.exe'));
  cands.push(path.join(__dirname, 'data', 'ffmpeg.exe'));
  cands.push(path.join(path.dirname(__dirname), 'ffmpeg.exe'));
  cands.push(path.join(path.dirname(path.dirname(__dirname)), 'ffmpeg.exe'));

  for (const p of cands) {
    try { if (fs.existsSync(p)) { _ffmpegCache = p; return p; } } catch (_) {}
  }
  // PATH 里的（Windows）
  const pathDirs = String(process.env.PATH || '').split(path.delimiter);
  for (const d of pathDirs) {
    const p = path.join(d, 'ffmpeg.exe');
    try { if (fs.existsSync(p)) { _ffmpegCache = p; return p; } } catch (_) {}
  }
  return '';
}

/* ---------------------------------------------------------------- 文件名 */
function safeFileName(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]/g, '_')   // Windows 非法字符
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '未命名';
}

function buildFileName(name, artist, ext) {
  const parts = [];
  if (artist) parts.push(safeFileName(artist));
  if (name) parts.push(safeFileName(name));
  const base = parts.join(' - ') || '未命名';
  return base + '.' + ext;
}

function uniquePath(dir, fileName) {
  let p = path.join(dir, fileName);
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  for (let i = 2; i < 1000; i++) {
    p = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(p)) return p;
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}

/* ---------------------------------------------------------------- 下载 */
/**
 * 下载一个音轨到磁盘。
 *
 * @param {string} url      音频直链（B站 dash 音轨，或任何 http(s)）
 * @param {string} name     歌名
 * @param {string} artist   歌手
 * @param {string} format   'm4a' | 'mp3'
 * @param {object} headers  额外请求头（B站需要 Referer）
 * @param {function} onProgress  进度回调 (received, total)
 */
async function downloadOne(url, name, artist, format, headers, onProgress, shouldCancel) {
  if (!url) throw new Error('缺少音频地址');
  const wantMp3 = (format === 'mp3');
  if (wantMp3 && !findFFmpeg()) {
    throw new Error('没有找到 ffmpeg，无法转 mp3。请改用 m4a 或安装 ffmpeg。');
  }

  /* 取消检查：每读一块数据问一次 */
  const cancelled = () => {
    try { return typeof shouldCancel === 'function' && shouldCancel(); } catch (_) { return false; }
  };

  const dir = DOWNLOAD_DIR || path.join(os.homedir(), 'Music', 'Mineradio');
  fs.mkdirSync(dir, { recursive: true });

  // 1. 先下到临时文件
  const tmpExt = '.part';
  const tmpPath = path.join(os.tmpdir(), 'mineradio-dl-' + Date.now() + '-' + Math.random().toString(36).slice(2) + tmpExt);

  /* 用 AbortController，取消时能立刻掐断 fetch */
  const ctl = new AbortController();
  const resp = await fetch(url, {
    headers: Object.assign({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
    }, headers || {}),
    signal: ctl.signal,
  });
  if (!resp.ok) throw new Error('下载失败 HTTP ' + resp.status);

  const total = Number(resp.headers.get('content-length') || 0);
  let received = 0;

  const ws = fs.createWriteStream(tmpPath);
  const reader = resp.body.getReader();
  let wasCancelled = false;
  try {
    while (true) {
      if (cancelled()) {
        wasCancelled = true;
        try { await reader.cancel(); } catch (_) {}
        try { ctl.abort(); } catch (_) {}
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      ws.write(Buffer.from(value));
      if (onProgress) { try { onProgress(received, total); } catch (_) {} }
    }
  } finally {
    await new Promise(res => ws.end(res));
  }

  if (wasCancelled) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    const err = new Error('CANCELLED');
    err.code = 'CANCELLED';
    throw err;
  }

  // 2. 决定最终路径
  const finalExt = wantMp3 ? 'mp3' : 'm4a';
  const fileName = buildFileName(name, artist, finalExt);
  const finalPath = uniquePath(dir, fileName);

  if (wantMp3) {
    // 转码
    await transcodeToMp3(tmpPath, finalPath);
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  } else {
    fs.renameSync(tmpPath, finalPath);
  }

  const size = (() => { try { return fs.statSync(finalPath).size; } catch (_) { return 0; } })();

  return {
    path: finalPath,
    name: path.basename(finalPath),
    size,
    format: finalExt,
  };
}

function transcodeToMp3(input, output) {
  const ff = findFFmpeg();
  if (!ff) return Promise.reject(new Error('缺少 ffmpeg'));

  return new Promise((resolve, reject) => {
    const args = [
      '-y',                 // 覆盖
      '-i', input,
      '-vn',                // 丢掉视频轨（B站音轨没有，但保险）
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-id3v2_version', '3',
      output,
    ];
    const p = spawn(ff, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
    p.on('error', e => reject(new Error('ffmpeg 启动失败: ' + e.message)));
    p.on('close', code => {
      if (code === 0) resolve(output);
      else reject(new Error('ffmpeg 转码失败 (code ' + code + ')'));
    });
  });
}

/* ---------------------------------------------------------------- 歌单批量 */
/**
 * 批量下载（不阻塞，用任务表跟踪进度）。
 * 返回 taskId，前端轮询 /api/download/status?id=xxx
 */
const tasks = new Map();

function createTask(items) {
  const id = 'dl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const t = {
    id,
    createdAt: Date.now(),
    total: items.length,
    done: 0,
    failed: 0,
    current: '',
    running: true,
    results: [],
    cancelled: false,
  };
  tasks.set(id, t);
  runTask(t, items).catch(e => {
    console.warn('[Download] 任务失败', e.message);
    t.running = false;
    t.error = e.message;
  });
  return t;
}

async function runTask(t, items) {
  for (const it of items) {
    if (t.cancelled) break;
    t.current = it.name || '';
    try {
      const r = await downloadOne(
        it.url, it.name, it.artist, it.format, it.headers,
        (rec, tot) => { t.bytesReceived = rec; t.bytesTotal = tot; },
        /* 每读一块数据都会问这个函数：任务被取消了吗 */
        () => t.cancelled === true
      );
      t.done++;
      t.results.push({ ok: true, name: it.name, path: r.path, size: r.size });
    } catch (e) {
      if (e && e.code === 'CANCELLED') {
        console.log('[Download] 已取消:', it.name);
        break;   // 直接跳出，不再下后面的
      }
      t.failed++;
      t.results.push({ ok: false, name: it.name, error: e.message });
    }
  }
  t.running = false;
  t.current = '';
  if (t.cancelled) console.log('[Download] 任务已停止，完成', t.done, '首');
}

function getTask(id) {
  return tasks.get(id) || null;
}

function cancelTask(id) {
  const t = tasks.get(id);
  if (t) t.cancelled = true;
  return !!t;
}

/* 清理老任务（保留最近 50 个） */
function pruneTasks() {
  if (tasks.size <= 50) return;
  const arr = Array.from(tasks.values()).sort((a, b) => a.createdAt - b.createdAt);
  for (let i = 0; i < arr.length - 50; i++) tasks.delete(arr[i].id);
}

module.exports = {
  init,
  getSettings,
  writeSettings,
  downloadOne,
  createTask,
  getTask,
  cancelTask,
  pruneTasks,
  findFFmpeg,
  buildFileName,
};
