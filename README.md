# 星穹全典 · Star Rail Codex

《崩坏：星穹铁道》角色、技能、数值、语音、立绘与剧情台词的离线可检索档案。不是一张巨型 HTML，而是「静态前端 + 分卷 JSON + 按需全文索引 + PWA 离线缓存」的可扩展项目。

仓库：<https://github.com/zacLoveyinlang/starrail-archive>

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

## 为什么有 9 位 BWIKI 独有资料角色

米游社「角色一览」返回 94 个可玩角色入口；BWIKI 的 `Category:角色` 还混有剧情 NPC、组织成员、联动/活动词条和通用角色页。按规范化名称合并后，有 9 个 BWIKI 词条在官方入口中找不到对应项，因此单独保留为 `playable=false` 的「资料角色」：

1. **开拓者**：BWIKI 的通用页，不是额外角色；官方把开拓者按命途拆成了毁灭、存护、同谐、记忆、欢愉等形态。
2. **欧泊**：星际和平公司相关人物，无可玩技能数据。
3. **耀嘉音**：BWIKI 4.8 版本词条，当前无可玩数据。
4. **舒俱**：星际和平公司相关人物，无可玩技能数据。
5. **艾利欧**：星核猎手相关人物，无可玩技能数据。
6. **艾莲**：BWIKI 4.8 版本词条，当前无可玩数据。
7. **芮克先生**：剧情人物，无可玩数据。
8. **螺丝咕姆**：天才俱乐部相关人物，无可玩数据。
9. **龙晶**：星际和平公司相关人物，无可玩技能数据。

界面默认开启「仅可玩角色」，这 9 位会被隐藏；关闭该开关后才会出现在图鉴里，并带有「资料角色」标记。

## 数据来源

- **米游社·开拓者笔记**：角色基础资料、技能、等级数值、星魂、官方语音与画廊。平台由米哈游提供技术支持。
- **哔哩哔哩 BWIKI**：任务正文、选项分支、部分缺失字段与立绘文件索引。BWIKI 是社区共建维基，社区字段不会被标成官方设定。

每条角色与剧情都保留原页面链接。图片和音频以原始 CDN 地址引用，未复制、未转售。

## 运行

```bash
git clone https://github.com/zacLoveyinlang/starrail-archive.git
cd starrail-archive
python3 -m http.server 8123 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8123/#/home`。不要直接双击 `index.html`，浏览器会阻止读取本地 JSON。

## 结构

```text
index.html                    应用入口
app.css / app.js              视觉、路由、角色 / 剧情 / 搜索 / 收藏 / PWA
manifest.webmanifest          PWA 清单
sw.js                         Service Worker
data/meta.json                全局统计与来源声明
data/characters/index.json    角色索引
data/characters/cXXX.json     单角色详情卷
data/stories/index.json       剧情索引
data/stories/sXXXX.json       单剧情详情卷
data/search/story-lines.json  全库台词索引（约 16 MB，按需载入）
tools/import_data.py          米游社 / BWIKI 导入器
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
- 本项目为非官方玩家档案，角色、剧情、语音、图片版权归米哈游及原权利人所有。代码采用 MIT 许可，数据不随代码授权，详见 `DATA-NOTICE.md`。
- 当前未生成 APK，交付形态是可安装 PWA；GitHub Pages 尚未启用，仓库本身已包含完整可运行源码与数据。
