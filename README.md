# 星穹全典 · Star Rail Codex

《崩坏：星穹铁道》角色、技能、数值、语音、立绘与剧情台词的离线可检索档案。不是一张巨型 HTML，而是「静态前端 + 分卷 JSON + 按需全文索引 + PWA 离线缓存」的可扩展项目。

## 当前收录

| 项目 | 数量 |
|---|---:|
| 角色档案 | 103 |
| 米游社官方平台角色 | 94 |
| BWIKI 独有资料角色 | 9 |
| 技能 / 行迹 / 星魂等条目 | 1,940 |
| 角色语音文本 | 21,709 |
| 立绘 / 头像索引 | 436 |
| 剧情任务 | 581 |
| 剧情台词（含分支） | 89,609 |
| 分支选项组 | 7,004 |

剧情台词按分支全部计入，不做单一路线去重；因此「含分支台词数」大于一次通关实际听到的句数。

## 数据来源

- **米游社·开拓者笔记**：角色基础资料、技能、等级数值、星魂、官方语音与画廊。平台由米哈游提供技术支持。
- **哔哩哔哩 BWIKI**：任务正文、选项分支、部分缺失字段与立绘文件索引。BWIKI 是社区共建维基，社区字段不会被标成官方设定。

每条角色与剧情都保留原页面链接。图片和音频以原始 CDN 地址引用，未复制、未转售。

## 运行

```bash
cd starrail-archive
python3 -m http.server 8123 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8123/#/home`。不要直接双击 `index.html`，浏览器会阻止读取本地 JSON。

## 结构

```text
index.html                 应用入口
app.css / app.js           视觉、路由、角色 / 剧情 / 搜索 / 收藏 / PWA
manifest.webmanifest       PWA 清单
sw.js                      Service Worker
data/meta.json             全局统计与来源声明
data/characters/index.json 角色索引
data/characters/cXXX.json  单角色详情卷
data/stories/index.json    剧情索引
data/stories/sXXXX.json    单剧情详情卷
data/search/story-lines.json 全库台词索引（约 16 MB，按需载入）
tools/import_data.py       米游社 / BWIKI 导入器
```

## 重新导入

```bash
python3 tools/import_data.py characters
python3 tools/import_data.py stories
python3 tools/import_data.py search
python3 tools/import_data.py meta
```

导入器会缓存原始 HTTP 响应到 `.work/cache/`；`.work/` 不进入发布包。

## 边界

- 581 个任务、89,609 句是两站公开词条可抓取的范围，不等于游戏内每一句演出文本或每一个语音文件。
- 9 个 BWIKI 独有资料角色没有可玩技能与语音，界面标为「资料角色」。
- 立绘画廊收录官方立绘与角色专属 BWIKI 立绘/头像文件索引，不包含游戏内全部 CG。
- 本项目为非官方玩家档案，角色、剧情、语音、图片版权归米哈游及原权利人所有。代码可复用，数据不随代码授权。

## 尚未完成

GitHub 仓库尚未创建或推送；仓库名、公开/私有属性与是否启用 GitHub Pages 需用户确认。当前未生成 APK，交付形态是可安装 PWA，可后续用 WebView 壳打包。
