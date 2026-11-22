# NOTICE

OnlyEars 使用了以下第三方项目。各项目版权归其原作者所有。

---

## 上游项目

**Mineradio** — https://github.com/XxHuberrr/Mineradio-paused

本项目的界面框架、歌词渲染引擎、粒子系统、视觉控制台、Electron 主进程结构，
全部来自 Mineradio，以 **GPL-3.0-only** 协议开源。

OnlyEars 是 Mineradio 的衍生作品（derivative work），同样以 GPL-3.0-only 发布。

**Mineradio 中的以下部分并非原作者原创，而是从其他 GPL-3.0 项目移植：**

- **Cuefield AutoMix planner/runtime**
  ← [SLYysl/cuefield-mineradio](https://github.com/SLYysl/cuefield-mineradio) @ `c16f05a0bc731a49da7d42c135337fcac58f6dba`（GPL-3.0）

- **Wallpaper Engine 本地库检测与导入 UX**
  ← [ww085213/Mineradio-LX-Music](https://github.com/ww085213/Mineradio-LX-Music) @ `a5ef80a219709080700be5b1d00f1ea71a5a2576`（GPL-3.0）

- **全屏桌面模式 / 首页信息层级**
  ← [ww085213/Mineradio-LX-Music](https://github.com/ww085213/Mineradio-LX-Music) @ `82826df814c32853d99697c0ee60f749a2fcad79`、`812e2dc2e18bbc263e61dbd0206cb765e003d6e9`（GPL-3.0）

- **汽水音乐 Passport Web 扫码登录桥接**
  ← [Wx2yZx/Mineradio-Qishui-QR-Login](https://github.com/Wx2yZx/Mineradio-Qishui-QR-Login) @ `aaadaab7d011714f94fbe45b382ba8dcc7cf17b9`（GPL-3.0-only）

---

## 前端库

| 库 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| [Three.js](https://threejs.org/) | r128 | MIT | 3D 渲染（粒子、歌词舞台） |
| [GSAP](https://greensock.com/gsap/) | 3.x | 标准免版税许可 | 动画与时间轴 |
| [music-tempo](https://github.com/killercrush/music-tempo) | — | MIT | 音频节拍检测 |
| [Sonic Workshop](https://github.com/mrdoob/three.js) | — | MIT | 音频可视化着色器预设 |

**注意**：GSAP 使用 GreenSock 的标准免版税许可（Standard "No Charge" License），
允许在免费/开源的最终产品中使用。若用于商业产品需另外授权，详见
https://greensock.com/standard-license/

---

## 后端依赖

本项目打包时仅保留实际使用的依赖，其余已移除。

**直接依赖：**

| 包 | 许可证 | 用途 |
|---|---|---|
| [mpg123-decoder](https://github.com/eshaz/wasm-audio-decoders) | MIT | MP3 解码（节拍分析用） |
| [qrcode](https://github.com/soldair/node-qrcode) | MIT | 二维码生成（登录用） |
| [express](https://expressjs.com/) 及其生态 | MIT | HTTP 服务 |
| [axios](https://axios-http.com/) | MIT | HTTP 客户端 |
| [file-type](https://github.com/sindresorhus/file-type) | MIT | 文件类型嗅探 |
| [music-metadata](https://github.com/borewit/music-metadata) | MIT | 音频元数据解析 |

**其余传递依赖**（mime-types、qs、debug、iconv-lite、sax、xmlbuilder、socks 等）
均为 MIT / ISC / BSD / Apache-2.0 等宽松许可证，完整列表见各包目录下的 `LICENSE` 文件。

完整依赖树可通过 `npm ls --all` 复现。

---

## 运行时环境

| 组件 | 许可证 |
|---|---|
| [Electron](https://www.electronjs.org/) | MIT |
| [Chromium](https://www.chromium.org/) | BSD-3-Clause 等 |
| [Node.js](https://nodejs.org/) | MIT |
| [ffmpeg](https://ffmpeg.org/)（可选，用于 mp3 转码） | LGPL-2.1+ / GPL-2.0+（取决于构建） |

Electron 自带的 Chromium/Node 许可证全文见安装目录下的
`LICENSE.electron.txt` 与 `LICENSES.chromium.html`。

---

## 字体

| 字体 | 许可证 |
|---|---|
| Noto Sans / Noto Sans SC | SIL Open Font License 1.1 |
| Inter | SIL Open Font License 1.1 |
| JetBrains Mono | SIL Open Font License 1.1 |
| Cinzel Decorative | SIL Open Font License 1.1 |

字体通过 Google Fonts CDN 引用，不随本项目分发。

---

## 服务

OnlyEars 通过 **Bilibili 的公开 Web API** 获取搜索结果与音频流地址。

- 本程序不存储、不缓存、不重新分发任何音视频内容
- 不绕过任何付费、会员或 DRM 保护机制
- 仅访问无需登录即可获得的数据

Mineradio 原有代码中可能包含与网易云音乐、QQ 音乐、酷狗、汽水音乐等平台的
交互逻辑。**OnlyEars 未启用这些平台**（相关模块已移除或禁用），
仅使用 Bilibili 作为音源。

---

## 原创声明

以下内容属于原作者（XxHuberrr）的原创设计与产品表达，
OnlyEars 保留但未主张任何权利：

- Mineradio 名称与 MR Logo
- 界面视觉设计体系
- 启动动画方向
- 粒子视觉体验
- 电影镜头系统

以下内容为 OnlyEars 新增：

- Bilibili API 接入层（wbi 签名、候选打分、DASH 取流）
- 音源匹配算法
- 下载引擎
- 本地歌单与播放历史（同曲去重）
- 每日电台
- 极简模式（三档性能切换）
- 意见反馈面板

**OnlyEars 与 Mineradio 原作者无隶属关系，也未经其官方认可。**
