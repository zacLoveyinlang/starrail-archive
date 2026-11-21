#!/usr/bin/env python3
"""Import public Star Rail wiki data into a local, static JSON archive.

Primary sources:
  * 米游社 开拓者笔记 (Miyoushe, platform supported by miHoYo)
  * 哔哩哔哩 BWIKI (community-maintained; not an official miHoYo publication)

The importer is intentionally conservative: it reads the two sites' public
interfaces, keeps per-record source URLs, and never stores cookies or account
data. Run it again to refresh the archive.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import html as html_module
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CACHE = ROOT / ".work" / "cache"
MYS_API = "https://act-api-takumi.mihoyo.com/common/blackboard/sr_wiki/v1"
BWIKI_API = "https://wiki.biligame.com/sr/api.php"
MYS_HOME = "https://bbs.mihoyo.com/sr/wiki/"
BWIKI_HOME = "https://wiki.biligame.com/sr/"
UA = "StarRailArchive/1.0 (+local fan archive; source-linked, non-commercial)"
NOW = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

STORY_CATEGORIES = [
    "开拓任务", "同行任务", "冒险任务", "活动任务",
    "系列任务", "终末任务", "日常任务", "玩法任务",
]


def log(*args: Any) -> None:
    print(*args, flush=True)


def cache_path(kind: str, key: str) -> Path:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
    return CACHE / kind / f"{digest}.json"


def fetch_json(url: str, *, kind: str = "http", force: bool = False) -> dict:
    path = cache_path(kind, url)
    if path.exists() and not force:
        return json.loads(path.read_text(encoding="utf-8"))
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/json,text/html;q=0.9",
            "Referer": MYS_HOME if "mihoyo" in url else BWIKI_HOME,
        },
    )
    last: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=35) as response:
                payload = json.loads(response.read().decode("utf-8"))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            return payload
        except Exception as exc:  # noqa: BLE001 - retry is useful across both APIs
            last = exc
            time.sleep(0.8 + attempt * 1.4)
    raise RuntimeError(f"fetch failed: {url}: {last}")


def api_url(path: str, **params: Any) -> str:
    params.setdefault("app_sn", "sr_wiki")
    return f"{MYS_API}/{path}?{urllib.parse.urlencode(params)}"


def bwiki_url(**params: Any) -> str:
    params.setdefault("format", "json")
    params.setdefault("formatversion", "2")
    return f"{BWIKI_API}?{urllib.parse.urlencode(params)}"


class TextHTMLParser(HTMLParser):
    """Small, whitelist-free HTML-to-text converter."""

    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "table"}
    SKIP = {"script", "style"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP:
            self.skip_depth += 1
        if tag in self.BLOCK and self.parts:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self.skip_depth:
            self.skip_depth -= 1
        if tag in self.BLOCK and self.parts:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(data)


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    parser = TextHTMLParser()
    parser.feed(value)
    text = html.unescape("".join(parser.parts))
    text = text.replace("\u00a0", " ")
    lines = []
    for line in text.splitlines():
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def normalize_name(name: str) -> str:
    name = name.strip().lower().replace(" ", "")
    name = name.replace("（", "·").replace("(", "·").replace("）", "").replace(")", "")
    name = re.sub(r"[•·・]", "·", name)
    return name


ELEMENT_CANON = {
    "物理": "physical", "火": "fire", "冰": "ice", "雷": "lightning",
    "风": "wind", "量子": "quantum", "虚数": "imaginary",
    "physical": "physical", "fire": "fire", "ice": "ice", "lightning": "lightning",
    "wind": "wind", "quantum": "quantum", "imaginary": "imaginary",
}
PATH_CANON = {
    "毁灭": "Destruction", "巡猎": "Hunt", "智识": "Erudition", "同谐": "Harmony",
    "虚无": "Nihility", "存护": "Preservation", "丰饶": "Abundance", "记忆": "Remembrance", "欢愉": "Elation",
    "destruction": "Destruction", "hunt": "Hunt", "thehunt": "Hunt", "erudition": "Erudition",
    "harmony": "Harmony", "nihility": "Nihility", "preservation": "Preservation",
    "abundance": "Abundance", "remembrance": "Remembrance", "memory": "Remembrance", "elation": "Elation",
}


def canonical_element(value: str) -> str:
    value = (value or "").strip()
    return ELEMENT_CANON.get(value) or ELEMENT_CANON.get(value.lower()) or value


def canonical_path(value: str) -> str:
    value = (value or "").strip()
    return PATH_CANON.get(value) or PATH_CANON.get(value.lower()) or value


def clean_wiki(value: str, *, max_len: int | None = None) -> str:
    """Convert common MediaWiki markup to readable plain text."""
    value = value or ""
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"\{\{语音\|[^}]*\}\}", "", value)
    value = re.sub(r"\{\{图片放大\|([^|}]+)[^}]*\}\}", r"[图片：\1]", value)
    value = re.sub(r"\{\{图标\|([^|}]+)(?:\|([^|}]+))?\}\}", lambda m: m.group(1) + (("×" + m.group(2)) if m.group(2) else ""), value)
    value = re.sub(r"\{\{注音\|([^|}]+)\|([^|}]+)\}\}", r"\1（\2）", value)
    value = re.sub(r"\{\{颜色\|[^|}]+\|([^{}]*)\}\}", r"\1", value)
    value = re.sub(r"\{\{(?:黑幕|ruby|强调)\|([^{}]*)\}\}", r"\1", value)
    # Drop remaining simple templates but preserve any trailing text inside.
    for _ in range(4):
        value = re.sub(r"\{\{[^{}]*\}\}", "", value)
    value = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", value)
    value = re.sub(r"\[\[([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"\[https?://[^\s\]]+\s*([^\]]*)\]", r"\1", value)
    value = value.replace("'''", "").replace("''", "")
    value = re.sub(r"^[*:;#]+\s*", "", value, flags=re.M)
    value = html_module.unescape(value).replace("\u00a0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    value = value.strip()
    if max_len:
        value = value[:max_len].rstrip() + ("…" if len(value) > max_len else "")
    return value


def split_brace_template(text: str, start: int) -> tuple[str, int]:
    """Return (whole template, index after closing braces)."""
    depth = 0
    i = start
    while i < len(text) - 1:
        if text[i:i + 2] == "{{":
            depth += 1
            i += 2
            continue
        if text[i:i + 2] == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return text[start:i], i
            continue
        i += 1
    return text[start:], len(text)


def split_template_params(inner: str) -> list[str]:
    """Split a template body on top-level pipes."""
    out, buf, depth = [], [], 0
    i = 0
    while i < len(inner):
        if inner[i:i + 2] == "{{":
            depth += 1
            buf.append("{{")
            i += 2
            continue
        if inner[i:i + 2] == "}}":
            depth -= 1
            buf.append("}}")
            i += 2
            continue
        if inner[i] == "|" and depth == 0:
            out.append("".join(buf).strip())
            buf = []
            i += 1
            continue
        buf.append(inner[i])
        i += 1
    out.append("".join(buf).strip())
    return out


def parse_template(raw: str) -> tuple[str, dict[str, str], list[str]]:
    body = raw[2:-2]
    parts = split_template_params(body)
    name = parts[0].strip() if parts else ""
    named: dict[str, str] = {}
    positional: list[str] = []
    for part in parts[1:]:
        if "=" in part:
            key, val = part.split("=", 1)
            named[key.strip()] = val.strip()
        else:
            positional.append(part.strip())
    return name, named, positional


def find_templates(text: str, wanted: str | Iterable[str]) -> list[tuple[int, int, str]]:
    names = {wanted} if isinstance(wanted, str) else set(wanted)
    found: list[tuple[int, int, str]] = []
    i = 0
    while i < len(text) - 1:
        j = text.find("{{", i)
        if j < 0:
            break
        whole, after = split_brace_template(text, j)
        try:
            name, _, _ = parse_template(whole)
        except Exception:  # malformed wiki syntax: skip token
            name = ""
        if name in names:
            found.append((j, after, whole))
        i = max(after, j + 2)
    return found


def extract_task_template(wikitext: str) -> dict[str, str]:
    # The task infobox is often a large template; find its end and parse top-level fields.
    for name in ("任务", "系列任务"):
        templates = find_templates(wikitext, name)
        if templates:
            _, _, raw = templates[0]
            _, fields, _ = parse_template(raw)
            return fields
    return {}


def parse_portrait_image(names: list[str], char_name: str) -> list[str]:
    keys = ("立绘", "头像", "角色", "星魂", "光锥")
    return [n for n in names if any(k in n for k in keys)]


def image_source_url(file_name: str) -> str:
    # Use the public file redirect. The API's canonical patchwiki URL is filled
    # in by resolve_image_urls when available.
    return "https://wiki.biligame.com/sr/Special:Redirect/file/" + urllib.parse.quote(file_name)


def parse_infobox(wikitext: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for name in ("角色图鉴", "角色", "角色图鉴/技能"):
        for _, _, raw in find_templates(wikitext, name):
            _, part, _ = parse_template(raw)
            fields.update(part)
    return fields


def owned_art(filename: str, *names: str) -> bool:
    """Only keep files that belong to this character, not nav/template art."""
    stem = filename.rsplit(".", 1)[0]
    candidates = {n.replace("•", "·").replace("・", "·") for n in names if n}
    stem_cmp = stem.replace("•", "·").replace("・", "·")
    for candidate in candidates:
        if stem_cmp == candidate or stem_cmp.startswith(candidate + "立绘"):
            return True
        if stem_cmp in {candidate + "竖版头像", candidate + "头像"}:
            return True
    return False


def parse_bwiki_voices(title: str) -> list[dict[str, Any]]:
    try:
        page = bwiki_page(title + "/语音")
    except Exception:
        return []
    wikitext = (page.get("parse") or {}).get("wikitext", "")
    if not wikitext:
        return []
    lines = []
    for _, _, raw in find_templates(wikitext, "角色语音"):
        _, f, _ = parse_template(raw)
        content = clean_wiki(f.get("语音内容", ""))
        if not content:
            continue
        lines.append({
            "type": clean_wiki(f.get("语音类型", "")),
            "name": clean_wiki(f.get("语音类型", "")),
            "text": content,
            "audioUrl": "",
            "audioName": "",
            "translations": {
                "ja": clean_wiki(f.get("语音内容日语", "")),
                "en": clean_wiki(f.get("语音内容英语", "")),
                "ko": clean_wiki(f.get("语音内容韩语", "")),
            },
        })
    return [{"name": "角色语音（BWIKI）", "lines": lines}] if lines else []


def bwiki_pages_for_categories(categories: list[str]) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for category in categories:
        data = fetch_json(
            bwiki_url(action="query", list="categorymembers", cmtitle=f"Category:{category}", cmlimit="500"),
            kind="bwiki_category",
        )
        for row in data.get("query", {}).get("categorymembers", []):
            title = row.get("title")
            if title:
                rows.setdefault(title, {"title": title, "categories": []})["categories"].append(category)
    return list(rows.values())


def bwiki_page(title: str) -> dict[str, Any]:
    return fetch_json(
        bwiki_url(action="parse", page=title, prop="wikitext|images", disablelimitreport="1"),
        kind="bwiki_page",
    )


def resolve_image_urls(file_names: list[str]) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    for start in range(0, len(file_names), 40):
        chunk = file_names[start:start + 40]
        titles = "|".join("File:" + name for name in chunk)
        data = fetch_json(
            bwiki_url(action="query", titles=titles, prop="imageinfo", iiprop="url|size|mime", iiurlwidth="1200"),
            kind="bwiki_images",
        )
        for page in data.get("query", {}).get("pages", []):
            title = page.get("title", "").removeprefix("File:").removeprefix("文件:")
            info = (page.get("imageinfo") or [{}])[0]
            if info.get("url"):
                results[title] = {
                    "url": info.get("url"),
                    "thumbUrl": info.get("thumburl") or info.get("url"),
                    "width": info.get("width"),
                    "height": info.get("height"),
                    "mime": info.get("mime"),
                }
        time.sleep(0.15)
    return results


def official_character_list() -> list[dict[str, Any]]:
    data = fetch_json(api_url("content/info", content_id="814"), kind="mys_content")
    content = data["data"]["content"]
    texts = "\n".join(x.get("text", "") for x in content.get("contents", []))
    pat = re.compile(r'<a[^>]*href="(?:https://bbs\.mihoyo\.com)?/sr/wiki/content/(\d+)/detail[^"]*"[^>]*>(.*?)</a>', re.S)
    out: dict[str, dict[str, Any]] = {}
    for cid, body in pat.findall(texts):
        m = re.search(r"<div[^>]*>(.*?)</div>", body, re.S)
        if not m:
            continue
        name = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
        if name:
            out.setdefault(cid, {"contentId": int(cid), "name": name})
    log(f"米游社角色入口：{len(out)} 个")
    return list(out.values())


def parse_character_modules(raw: dict[str, Any]) -> dict[str, Any]:
    content = raw["data"]["content"]
    rpg = content.get("rpg_new_tmp_content") or {}
    base = rpg.get("base") or {}
    user = base.get("userInfo") or {}
    modules: dict[str, Any] = {}
    for module in rpg.get("modules", []):
        for component in module.get("components", []):
            payload = component.get("data")
            try:
                modules[component.get("componentId", "")] = json.loads(payload) if isinstance(payload, str) else payload
            except Exception:
                modules[component.get("componentId", "")] = {}
        modules.setdefault("__module_names__", {})[module.get("name", "")] = module
    return {"content": content, "base": base, "user": user, "modules": modules}


def parse_eidolons_rich(rich_text: str) -> list[dict[str, Any]]:
    if not rich_text:
        return []
    # Each heading is followed by the effect paragraph in the next table row.
    parts = re.split(r"<h3[^>]*>(.*?)</h3>", rich_text, flags=re.S | re.I)
    out = []
    for idx in range(1, len(parts), 2):
        heading = html_to_text(parts[idx])
        tail = parts[idx + 1] if idx + 1 < len(parts) else ""
        desc = html_to_text(tail)
        # Cut at the next non-effect table cell / image block when the parser has
        # pulled in the next header's image markup.
        desc = re.split(r"\n(?=【\d+】)", desc)[0].strip()
        m = re.search(r"【(\d+)】\s*(.*)", heading)
        out.append({
            "index": int(m.group(1)) if m else len(out) + 1,
            "name": (m.group(2) if m else heading).strip(),
            "description": desc,
        })
    return out


def parse_skills(graph: dict[str, Any]) -> list[dict[str, Any]]:
    points = graph.get("points") or []
    skills = []
    for point in points:
        table = point.get("tableData") or {}
        subs = []
        for sub in point.get("subList") or []:
            subs.append({
                "title": sub.get("subTitle") or "",
                "tags": sub.get("subTag") or [],
                "description": html_to_text(sub.get("subDesc")),
                "image": sub.get("image") or "",
            })
        skills.append({
            "type": point.get("tag") or "",
            "name": point.get("name") or "",
            "icon": point.get("icon") or "",
            "table": {
                "headers": table.get("headers") or [],
                "rows": table.get("rows") or [],
            },
            "entries": subs,
        })
    return skills


def parse_voice_module(voice: dict[str, Any]) -> list[dict[str, Any]]:
    groups = []
    for item in voice.get("list", []):
        table = item.get("table") or []
        if not table:
            continue
        lines = []
        for row in table:
            if not isinstance(row, dict):
                continue
            content = row.get("content") or row.get("text") or ""
            if not content:
                continue
            lines.append({
                "type": row.get("type") or item.get("tabName") or "",
                "name": row.get("name") or "",
                "text": html_to_text(content),
                "audioUrl": row.get("audioUrl") or "",
                "audioName": row.get("audio_name") or "",
            })
        groups.append({"name": item.get("tabName") or "", "lines": lines})
    return groups


def parse_gallery(gallery: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for item in gallery.get("list", []):
        for row in item.get("table") or []:
            if not isinstance(row, dict):
                continue
            image = row.get("image") or (row.get("imageMeta") or {}).get("image", {}).get("url") or ""
            if not image:
                continue
            out.append({
                "name": row.get("name") or "",
                "image": image,
                "source": row.get("source") or "",
                "url": row.get("url") or "",
                "kind": "video-thumbnail" if row.get("url", "").startswith("https://") else "image",
            })
    return out


def build_official_character(entry: dict[str, Any]) -> dict[str, Any]:
    raw = fetch_json(api_url("content/info", content_id=str(entry["contentId"])), kind="mys_character")
    parsed = parse_character_modules(raw)
    content, user, modules = parsed["content"], parsed["user"], parsed["modules"]
    info = {}
    for row in (modules.get("character_info") or {}).get("list", []):
        key = row.get("rightKey") or row.get("leftKey") or ""
        value = row.get("rightValue") or row.get("leftValue") or ""
        if key and value:
            info[key] = value
    ascension = (modules.get("role_ascension") or {}).get("list", [])
    stats: dict[str, Any] = {}
    for tab in ascension:
        attrs = {a.get("key"): (a.get("value") or [""])[0] for a in tab.get("attr", [])}
        if tab.get("tabName") in ("1级属性/晋阶所需材料", "80级属性"):
            stats["level1" if "1级" in tab.get("tabName", "") else "level80"] = attrs
    story_module = modules.get("character_story") or {}
    stories = [{
        "title": row.get("tabName") or "",
        "unlock": (row.get("append") or "").strip("（）()"),
        "text": html_to_text(row.get("desc")),
    } for row in story_module.get("list", [])]
    story_short = html_to_text(story_module.get("detail") or info.get("角色故事", ""))
    graph = modules.get("trace_graph") or {}
    skills = parse_skills(graph)
    rich = modules.get("character_rich") or {}
    eidolons = parse_eidolons_rich(rich.get("richText", ""))
    voices = parse_voice_module(modules.get("role_voice") or {})
    gallery = parse_gallery(modules.get("character_gallery") or {})
    source_url = f"https://bbs.mihoyo.com/sr/wiki/content/{entry['contentId']}/detail"
    return {
        "schema": 1,
        "id": "",
        "name": entry["name"] or user.get("name") or content.get("title", ""),
        "officialName": user.get("name") or entry["name"],
        "avatarId": user.get("avatarId") or "",
        "element": canonical_element(user.get("elementId") or ""),
        "path": canonical_path(user.get("baseType") or ""),
        "rarity": user.get("rarity") or (5 if "5星" in content.get("ext", "") else 4),
        "icon": user.get("icon") or "",
        "figure": user.get("figurePath") or "",
        "summary": clean_wiki(content.get("summary") or ""),
        "info": info,
        "stats": stats,
        "ascension": ascension,
        "skills": skills,
        "eidolons": eidolons,
        "stories": stories,
        "storyShort": story_short,
        "voices": voices,
        "gallery": gallery,
        "sources": [{
            "provider": "米游社·开拓者笔记",
            "type": "角色词条",
            "url": source_url,
            "contentId": entry["contentId"],
            "updated": content.get("mtime") or "",
        }],
        "dataStatus": "official-platform",
    }


def build_bwiki_only_character(title: str, wikitext: str, images: list[str], image_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    fields = parse_infobox(wikitext)
    name = fields.get("名称") or title
    level1, level80 = {}, {}
    for key in ("生命值", "攻击力", "防御力", "速度"):
        if fields.get(key):
            level1[key] = fields[key]
        if fields.get("80" + key):
            level80[key] = fields["80" + key]
    skills = []
    for kind in ("普攻", "战技", "终结技", "天赋", "秘技"):
        if not (fields.get(kind) or fields.get(kind + "描述")):
            continue
        table = {"headers": [], "rows": []}
        count = int(fields.get(kind + "属性数", "0") or 0)
        attrs = []
        for i in range(1, count + 1):
            label = clean_wiki(fields.get(f"{kind}属性{i}", ""))
            values = [v.strip() for v in clean_wiki(fields.get(f"{kind}属性{i}数据", "")).split("/") if v.strip()]
            if label and values:
                attrs.append((label, values))
        if attrs:
            table["headers"] = ["等级", *[label for label, _ in attrs]]
            for i in range(max(len(v) for _, v in attrs)):
                table["rows"].append([f"等级{i + 1}", *[(v[i] if i < len(v) else "") for _, v in attrs]])
        skills.append({
            "type": kind,
            "name": fields.get(kind, ""),
            "entries": [{"title": "", "tags": [clean_wiki(fields.get(kind + "TAG", ""))] if fields.get(kind + "TAG") else [], "description": clean_wiki(fields.get(kind + "描述", "")), "image": ""}],
            "table": table,
        })
    eidolons = []
    for i in range(1, 7):
        if fields.get(f"星魂{i}") or fields.get(f"星魂{i}描述"):
            eidolons.append({"index": i, "name": fields.get(f"星魂{i}", ""), "description": clean_wiki(fields.get(f"星魂{i}描述", ""))})
    stories = []
    for i in range(1, 5):
        if fields.get(f"角色故事{i}"):
            stories.append({"title": f"角色故事·其{'一二三四'[i-1]}", "unlock": "", "text": clean_wiki(fields[f"角色故事{i}"])})
    portraits = []
    for filename in images:
        if not any(x in filename for x in ("立绘", "头像")):
            continue
        if not owned_art(filename, name, title):
            continue
        meta = image_map.get(filename, {})
        portraits.append({
            "name": filename,
            "image": meta.get("url") or image_source_url(filename),
            "thumb": meta.get("thumbUrl") or meta.get("url") or image_source_url(filename),
            "width": meta.get("width"),
            "height": meta.get("height"),
            "kind": "portrait" if "立绘" in filename else "icon",
            "source": "哔哩哔哩 BWIKI",
        })
    source_url = f"https://wiki.biligame.com/sr/{urllib.parse.quote(title)}"
    return {
        "schema": 1, "id": "", "name": name, "officialName": title,
        "element": canonical_element(fields.get("元素属性", "")), "path": canonical_path(fields.get("命途", "")),
        "rarity": 5 if "5星" in fields.get("稀有度", "") else 4,
        "icon": next((p["image"] for p in portraits if p["kind"] == "icon"), ""),
        "figure": next((p["image"] for p in portraits if p["kind"] == "portrait"), ""),
        "summary": clean_wiki(fields.get("介绍") or fields.get("角色定位") or ""),
        "info": {k: clean_wiki(fields.get(k, "")) for k in ("阵营", "全名", "性别", "实装版本", "实装日期", "中文CV", "日文CV", "英文CV", "韩文CV") if fields.get(k)},
        "stats": {"level1": level1, "level80": level80},
        "ascension": [],
        "skills": skills,
        "eidolons": eidolons,
        "stories": stories,
        "storyShort": clean_wiki(fields.get("角色详细") or fields.get("介绍", "")),
        "voices": [],
        "gallery": portraits,
        "sources": [{"provider": "哔哩哔哩 BWIKI（社区共建）", "type": "角色词条", "url": source_url, "updated": ""}],
        "dataStatus": "community-wiki",
    }


def build_characters(force: bool = False) -> dict[str, Any]:
    log("拉取米游社角色入口…")
    official_entries = official_character_list()
    log("拉取 BWIKI 角色分类…")
    bwiki_rows = bwiki_pages_for_categories(["角色"])
    bwiki_titles = [row["title"] for row in bwiki_rows]
    log(f"BWIKI 角色分类：{len(bwiki_titles)} 个")

    official_by_key: dict[str, dict[str, Any]] = {}
    for entry in official_entries:
        record = build_official_character(entry)
        official_by_key[normalize_name(record["name"])] = record
        log("  米游社", record["name"], "技能", len(record["skills"]), "语音组", len(record["voices"]))
        time.sleep(0.12)

    # Add BWIKI metadata and portrait sets onto official records, and create
    # records for BWIKI-only characters.
    for title in bwiki_titles:
        try:
            page = bwiki_page(title)
        except Exception as exc:  # noqa: BLE001
            log("  BWIKI 读取失败", title, exc)
            continue
        parse = page.get("parse", {})
        wikitext = parse.get("wikitext", "")
        images = parse.get("images", []) or []
        fields = parse_infobox(wikitext)
        name = fields.get("名称") or title
        key = normalize_name(name)
        base = official_by_key.get(key)
        fallback = build_bwiki_only_character(title, wikitext, images, {})
        if base is None:
            base = fallback
            official_by_key[key] = base
            base.setdefault("wiki", {})
            base["wiki"] = {
                "title": title,
                "url": f"https://wiki.biligame.com/sr/{urllib.parse.quote(title)}",
                "fields": {k: clean_wiki(v, max_len=1200) for k, v in fields.items() if k in {
                    "阵营", "全名", "性别", "稀有度", "限定", "实装日期", "实装版本", "中文CV", "日文CV", "英文CV", "韩文CV",
                    "角色定位", "TAG", "昵称/外号", "短信签名", "卷首语",
                }},
                "images": images,
            }
        else:
            # A few official pages can be placeholders (for example 椒丘 was
            # temporarily empty on the platform API). Fill only missing fields
            # from the community wiki; never overwrite official values.
            if not base.get("summary") or re.match(r"^角色[-—·•]", base.get("summary", "")):
                base["summary"] = fallback.get("summary") or clean_wiki(fields.get("角色定位", ""))
            # Official placeholder records sometimes ship a default 4-star
            # rarity. The community infobox is used only to correct that
            # placeholder, never to downgrade a genuine 5-star record.
            if fallback.get("rarity") == 5 and base.get("rarity") == 4:
                base["rarity"] = 5
            for field_name in ("skills", "eidolons", "stories", "stats", "element", "path", "rarity", "icon", "figure", "summary"):
                if not base.get(field_name) and fallback.get(field_name):
                    base[field_name] = fallback[field_name]
            if not base.get("info") and fallback.get("info"):
                base["info"] = fallback["info"]
            if not base.get("storyShort") and fallback.get("storyShort"):
                base["storyShort"] = fallback["storyShort"]
            if not base.get("voices"):
                base["voices"] = parse_bwiki_voices(title)
            base.setdefault("wiki", {})
            base["wiki"] = {
                "title": title,
                "url": f"https://wiki.biligame.com/sr/{urllib.parse.quote(title)}",
                "fields": {k: clean_wiki(v, max_len=1200) for k, v in fields.items() if k in {
                    "阵营", "全名", "性别", "稀有度", "限定", "实装日期", "实装版本", "中文CV", "日文CV", "英文CV", "韩文CV",
                    "角色定位", "TAG", "昵称/外号", "短信签名", "卷首语",
                }},
                "images": images,
            }
            if not any(s.get("provider", "").startswith("哔哩哔哩") for s in base.get("sources", [])):
                base["sources"].append({"provider": "哔哩哔哩 BWIKI（社区共建）", "type": "角色词条补全", "url": base["wiki"]["url"], "updated": ""})
        time.sleep(0.12)

    # Resolve all BWIKI portrait URLs in batches.
    all_images: set[str] = set()
    for record in official_by_key.values():
        for filename in (record.get("wiki") or {}).get("images", []):
            if any(x in filename for x in ("立绘", "头像")) and owned_art(filename, record.get("name", ""), (record.get("wiki") or {}).get("title", "")):
                all_images.add(filename)
    log("解析立绘地址", len(all_images))
    image_map = resolve_image_urls(sorted(all_images)) if all_images else {}

    records = sorted(official_by_key.values(), key=lambda r: (r.get("name", ""), r.get("officialName", "")))
    for idx, record in enumerate(records, start=1):
        record["id"] = f"c{idx:03d}"
        record["playable"] = bool(
            record.get("dataStatus") == "official-platform"
            or (record.get("element") and record.get("path") and record.get("skills"))
        )
        # Character-specific BWIKI portraits are kept alongside the official
        # figure path; bytes stay on the source CDN.
        gallery = []
        for filename in (record.get("wiki") or {}).get("images", []):
            if not any(x in filename for x in ("立绘", "头像")):
                continue
            if not owned_art(filename, record.get("name", ""), (record.get("wiki") or {}).get("title", "")):
                continue
            meta = image_map.get(filename, {})
            gallery.append({
                "name": filename,
                "image": meta.get("url") or image_source_url(filename),
                "thumb": meta.get("thumbUrl") or meta.get("url") or image_source_url(filename),
                "width": meta.get("width"),
                "height": meta.get("height"),
                "kind": "portrait" if "立绘" in filename else "icon",
                "source": "哔哩哔哩 BWIKI",
            })
        record["gallery"] = gallery
        # Unique by image URL, official imagery first.
        seen = set()
        record["artworks"] = []
        for extra in [{"name": "官方立绘", "image": record.get("figure", ""), "thumb": record.get("figure", ""), "kind": "portrait", "source": "米游社"}] + gallery:
            if extra["image"] and extra["image"] not in seen:
                seen.add(extra["image"])
                record.setdefault("artworks", []).append(extra)
        voice_count = sum(len(g.get("lines", [])) for g in record.get("voices", []))
        index_entry = {
            "id": record["id"],
            "name": record["name"],
            "element": record.get("element", ""),
            "path": record.get("path", ""),
            "rarity": record.get("rarity", 4),
            "icon": record.get("icon", ""),
            "figure": record.get("figure", ""),
            "summary": record.get("summary", ""),
            "faction": (record.get("info") or {}).get("阵营", ""),
            "version": (record.get("info") or {}).get("实装版本", "") or (record.get("wiki", {}).get("fields", {}) or {}).get("实装版本", ""),
            "skillCount": len(record.get("skills", [])),
            "voiceCount": voice_count,
            "storyCount": len(record.get("stories", [])),
            "artCount": len(record.get("artworks", [])),
            "source": record.get("sources", [{}])[0].get("provider", ""),
            "status": record.get("dataStatus", ""),
            "playable": record.get("playable", False),
        }
        (DATA / "characters" / f"{record['id']}.json").write_text(json.dumps(record, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        records[idx - 1]["_index"] = index_entry

    index = {
        "schema": 1,
        "generatedAt": NOW,
        "count": len(records),
        "officialPlatformCount": sum(1 for r in records if r.get("dataStatus") == "official-platform"),
        "communityOnlyCount": sum(1 for r in records if r.get("dataStatus") != "official-platform"),
        "sources": [
            {"name": "米游社·开拓者笔记", "url": MYS_HOME, "role": "官方平台支持的图鉴数据、语音与画廊"},
            {"name": "哔哩哔哩 BWIKI", "url": BWIKI_HOME, "role": "社区共建词条、剧情文本与额外立绘索引"},
        ],
        "characters": [r.pop("_index") for r in records],
    }
    (DATA / "characters" / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"角色导入完成：{len(records)} 条")
    return index


def parse_choice(raw: str) -> dict[str, Any]:
    _, fields, _ = parse_template(raw)
    options = []
    # Named fields are option1/剧情1 etc. Keep field order by numeric suffix.
    indices = []
    for key in fields:
        m = re.match(r"选项(\d+)$", key)
        if m:
            indices.append(int(m.group(1)))
    for i in sorted(indices):
        label = clean_wiki(fields.get(f"选项{i}", ""))
        branch = fields.get(f"剧情{i}", "")
        options.append({"label": label, "blocks": parse_story_fragment(branch)})
    return {"type": "choice", "options": options}


def parse_fold(raw: str) -> dict[str, Any]:
    _, fields, _ = parse_template(raw)
    return {
        "type": "fold",
        "title": clean_wiki(fields.get("标题", "")),
        "open": fields.get("折叠", "") not in ("是", "true", "1"),
        "blocks": parse_story_fragment(fields.get("内容", "")),
    }


def parse_story_fragment(fragment: str) -> list[dict[str, Any]]:
    """Parse a fragment of story wikitext into renderable blocks."""
    blocks: list[dict[str, Any]] = []
    # Replace top-level choice/fold templates with placeholders, preserving order.
    special: dict[str, str] = {}
    text = fragment
    for name in ("剧情选项", "折叠"):
        i = 0
        while True:
            found = find_templates(text[i:], name)
            if not found:
                break
            start, end, raw = found[0]
            abs_start, abs_end = i + start, i + end
            placeholder = f"\n@@SPECIAL_{len(special)}@@\n"
            special[placeholder.strip()] = raw
            text = text[:abs_start] + placeholder + text[abs_end:]
            i = abs_start + len(placeholder)
    # Some inline templates wrap across a newline. Join those lines first so a
    # dialogue is not truncated in the middle of a template invocation.
    joined: list[str] = []
    pending = ""
    for raw_line in text.splitlines():
        pending = f"{pending}{raw_line}" if pending else raw_line
        if pending.count("{{") - pending.count("}}") <= 0:
            joined.append(pending)
            pending = ""
    if pending:
        joined.append(pending)
    text = "\n".join(joined)
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("@@SPECIAL_"):
            raw = special.get(line.strip())
            if not raw:
                continue
            if raw.startswith("{{剧情选项"):
                blocks.append(parse_choice(raw))
            elif raw.startswith("{{折叠"):
                blocks.append(parse_fold(raw))
            continue
        if line.startswith("==="):
            blocks.append({"type": "heading", "text": clean_wiki(line.strip("= "))})
            continue
        if line.startswith("{{任务描述"):
            _, fields, _ = parse_template(line)
            blocks.append({
                "type": "note",
                "text": clean_wiki(fields.get("描述", "")),
                "location": clean_wiki(fields.get("地点", "")),
            })
            continue
        if line.startswith("{{图片放大"):
            _, fields, positional = parse_template(line)
            src = positional[0] if positional else fields.get("1", "")
            blocks.append({"type": "cg", "text": clean_wiki(src)})
            continue
        if line.startswith("{{") and line.endswith("}}"):
            # Unknown template: preserve readable text but avoid injecting HTML.
            cleaned = clean_wiki(line)
            if cleaned:
                blocks.append({"type": "note", "text": cleaned})
            continue
        if line.startswith(":"):
            cleaned = clean_wiki(line.lstrip(":"))
            if cleaned:
                blocks.append({"type": "note", "text": cleaned})
            continue
        if line.startswith("*"):
            cleaned = clean_wiki(line.lstrip("*"))
            if not cleaned:
                continue
            if "：" in cleaned or ":" in cleaned:
                sep = "：" if "：" in cleaned else ":"
                speaker, content = cleaned.split(sep, 1)
                blocks.append({"type": "dialogue", "speaker": speaker.strip(), "text": content.strip()})
            else:
                blocks.append({"type": "dialogue", "speaker": "", "text": cleaned})
            continue
        # Tables, file embeds, categories, and maintenance text are omitted.
        if line.startswith(("|", "!", "{{", "}}", "[[分类:", "[[Category:")):
            continue
        cleaned = clean_wiki(line)
        if cleaned:
            blocks.append({"type": "note", "text": cleaned})
    return blocks


def parse_story_page(title: str, wikitext: str, pageid: int | None = None, revision: int | None = None) -> dict[str, Any] | None:
    if not wikitext or "==剧情内容==" not in wikitext:
        return None
    fields = extract_task_template(wikitext)
    meta = {
        "name": clean_wiki(fields.get("任务名称") or "") or title,
        "type": clean_wiki(fields.get("任务类型") or "未分类"),
        "region": clean_wiki(fields.get("任务地区", "")),
        "version": clean_wiki(fields.get("所属版本", "")),
        "description": clean_wiki(fields.get("任务描述", "")),
        "characters": clean_wiki(fields.get("出场人物", "")),
        "series": clean_wiki(fields.get("系列任务", "")),
        "prerequisites": clean_wiki(fields.get("前置任务", "")),
        "next": clean_wiki(fields.get("后续任务", "")),
    }
    content_start = wikitext.find("==剧情内容==")
    content = wikitext[content_start + len("==剧情内容=="):]
    # Stop at categories or the next top-level maintenance section.
    content = re.split(r"\n\[\[(?:分类|Category):", content)[0]
    sections: list[dict[str, Any]] = []
    parts = re.split(r"^===\s*(.*?)\s*===\s*$", content, flags=re.M)
    # First part is intro before the first heading, if it contains dialogue.
    if parts and parts[0].strip():
        blocks = parse_story_fragment(parts[0])
        if any(b.get("type") == "dialogue" for b in blocks):
            sections.append({"title": "剧情内容", "blocks": blocks})
    for i in range(1, len(parts), 2):
        section_title = clean_wiki(parts[i])
        body = parts[i + 1] if i + 1 < len(parts) else ""
        blocks = parse_story_fragment(body)
        if blocks:
            sections.append({"title": section_title, "blocks": blocks})
    if not sections:
        return None

    def count_lines(items: list[dict[str, Any]]) -> int:
        count = 0
        for item in items:
            if item.get("type") == "dialogue":
                if str(item.get("text") or "").strip():
                    count += 1
            elif item.get("type") == "choice":
                count += sum(count_lines(o.get("blocks", [])) for o in item.get("options", []))
            elif item.get("type") == "fold":
                count += count_lines(item.get("blocks", []))
        return count

    line_count = count_lines([b for s in sections for b in s["blocks"]])
    return {
        "schema": 1,
        "id": "",
        "name": meta["name"],
        "type": meta["type"],
        "region": meta["region"],
        "version": meta["version"],
        "description": meta["description"],
        "characters": [x.strip() for x in meta["characters"].replace("、", ",").split(",") if x.strip()],
        "series": meta["series"],
        "prerequisites": meta["prerequisites"],
        "next": meta["next"],
        "sections": sections,
        "lineCount": line_count,
        "sources": [{
            "provider": "哔哩哔哩 BWIKI（社区共建）",
            "type": "剧情/任务词条",
            "url": f"https://wiki.biligame.com/sr/{urllib.parse.quote(title)}",
            "pageId": pageid,
            "revision": revision,
        }],
        "_title": title,
    }


def build_stories(force: bool = False) -> dict[str, Any]:
    log("拉取剧情任务分类…")
    rows = bwiki_pages_for_categories(STORY_CATEGORIES)
    titles = [r["title"] for r in rows]
    log(f"剧情/任务词条：{len(titles)} 个")
    stories = []
    for start in range(0, len(titles), 8):
        chunk = titles[start:start + 8]
        data = fetch_json(
            bwiki_url(
                action="query", titles="|".join(chunk), prop="revisions",
                rvprop="content|ids|timestamp", rvslots="main",
            ),
            kind="bwiki_revisions",
        )
        for page in data.get("query", {}).get("pages", []):
            if page.get("missing"):
                continue
            title = page.get("title", "")
            rev = (page.get("revisions") or [{}])[0]
            wikitext = (rev.get("slots", {}).get("main", {}) or {}).get("content", "")
            try:
                story = parse_story_page(title, wikitext, page.get("pageid"), rev.get("revid"))
            except Exception as exc:  # noqa: BLE001
                log("  解析失败", title, exc)
                continue
            if story:
                stories.append(story)
        log(f"  进度 {min(start + 8, len(titles))}/{len(titles)}，有效 {len(stories)}")
        time.sleep(0.2)
    stories.sort(key=lambda s: (s.get("version", ""), s.get("series", ""), s.get("name", "")))
    for idx, story in enumerate(stories, start=1):
        story["id"] = f"s{idx:04d}"
        title = story.pop("_title", story["name"])
        story["wikiTitle"] = title
        (DATA / "stories" / f"{story['id']}.json").write_text(json.dumps(story, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    index = {
        "schema": 1,
        "generatedAt": NOW,
        "count": len(stories),
        "lineCount": sum(s.get("lineCount", 0) for s in stories),
        "sources": [{"name": "哔哩哔哩 BWIKI", "url": BWIKI_HOME, "role": "任务页面的剧情正文与选项分支，社区共建"}],
        "stories": [{
            "id": s["id"], "name": s["name"], "type": s["type"], "region": s["region"],
            "version": s["version"], "series": s["series"], "lineCount": s["lineCount"],
            "description": s["description"], "characters": s["characters"],
        } for s in stories],
    }
    (DATA / "stories" / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"剧情导入完成：{len(stories)} 条，{index['lineCount']} 句")
    return index


def iter_story_lines(blocks: list[dict[str, Any]]) -> Iterable[dict[str, str]]:
    for block in blocks:
        if block.get("type") == "dialogue":
            yield {"speaker": block.get("speaker", ""), "text": block.get("text", "")}
        elif block.get("type") == "choice":
            for option in block.get("options", []):
                for line in iter_story_lines(option.get("blocks", [])):
                    yield line
        elif block.get("type") == "fold":
            yield from iter_story_lines(block.get("blocks", []))


def build_search_index() -> dict[str, Any]:
    story_index = json.loads((DATA / "stories" / "index.json").read_text(encoding="utf-8"))
    entries = []
    for s in story_index["stories"]:
        story = json.loads((DATA / "stories" / f"{s['id']}.json").read_text(encoding="utf-8"))
        for section in story["sections"]:
            for line in iter_story_lines(section["blocks"]):
                if len(line["text"]) < 1:
                    continue
                entries.append({
                    "s": story["id"],
                    "t": story["name"],
                    "h": section["title"],
                    "p": line["speaker"],
                    "x": line["text"],
                })
    payload = {"schema": 1, "generatedAt": NOW, "count": len(entries), "entries": entries}
    (DATA / "search" / "story-lines.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"剧情全文索引：{len(entries)} 句")
    return payload


def write_meta(char_index: dict, story_index: dict, search_index: dict) -> None:
    voice_count = 0
    skill_count = 0
    art_count = 0
    for item in char_index["characters"]:
        detail = json.loads((DATA / "characters" / f"{item['id']}.json").read_text(encoding="utf-8"))
        voice_count += item.get("voiceCount", 0)
        skill_count += len(detail.get("skills", []))
        art_count += len(detail.get("artworks", []))
    meta = {
        "schema": 1,
        "title": "星穹全典",
        "subtitle": "崩坏：星穹铁道 · 角色与剧情档案",
        "generatedAt": NOW,
        "counts": {
            "characters": char_index["count"],
            "officialPlatformCharacters": char_index["officialPlatformCount"],
            "communityOnlyCharacters": char_index["communityOnlyCount"],
            "stories": story_index["count"],
            "storyLines": search_index["count"],
            "skills": skill_count,
            "voices": voice_count,
            "artworks": art_count,
        },
        "sources": [
            {"name": "米游社·开拓者笔记", "url": MYS_HOME, "role": "角色基础资料、技能、数值、官方语音与画廊", "license": "内容权利归米哈游及相关权利人；本项目仅做检索与展示"},
            {"name": "哔哩哔哩 BWIKI", "url": BWIKI_HOME, "role": "社区共建的角色补全、剧情任务正文与立绘文件索引", "license": "社区内容遵循站点标注；转载与再利用前请核对原页面"},
        ],
        "notice": "非官方资料库。数据按原站公开页面整理，角色与剧情版权归米哈游及原权利人所有。",
    }
    (DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "data-report.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log("统计", json.dumps(meta["counts"], ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Star Rail archive data")
    parser.add_argument("target", choices=["characters", "stories", "search", "meta", "all"], nargs="?", default="all")
    parser.add_argument("--force", action="store_true", help="ignore HTTP cache")
    args = parser.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    for sub in ("characters", "stories", "search", "voices"):
        (DATA / sub).mkdir(parents=True, exist_ok=True)
    if args.target in ("characters", "all"):
        build_characters(args.force)
    if args.target in ("stories", "all"):
        build_stories(args.force)
    if args.target in ("search", "all"):
        build_search_index()
    if args.target in ("meta", "search", "all"):
        needed = [DATA / "characters" / "index.json", DATA / "stories" / "index.json", DATA / "search" / "story-lines.json"]
        if not all(p.exists() for p in needed):
            log("缺少索引文件，暂不生成 meta.json")
            return 0
        char_index = json.loads(needed[0].read_text(encoding="utf-8"))
        story_index = json.loads(needed[1].read_text(encoding="utf-8"))
        search_index = json.loads(needed[2].read_text(encoding="utf-8"))
        write_meta(char_index, story_index, search_index)
    return 0


if __name__ == "__main__":
    sys.exit(main())
