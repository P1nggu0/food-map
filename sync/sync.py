import hashlib
import io
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone

from openpyxl import load_workbook

SHARE_CODE = "cu4pzoapdtGT"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.join(os.path.dirname(BASE_DIR), "docs")
STATE_DIR = os.path.join(BASE_DIR, "state")
BILI_EXTRA_PATH = os.path.join(BASE_DIR, "bili_extra.json")
BILI_CACHE_PATH = os.path.join(STATE_DIR, "bili_cache.json")
BILI_SEASON_BVID = "BV1zLuq6FEXq"
BILI_START_DATE = "2026-09-29"
BILI_CACHE_SECONDS = 2 * 24 * 60 * 60

TZ = timezone(timedelta(hours=8))


def now_text(dt):
    return dt.strftime("%Y-%m-%d %H:%M")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def fetch_json(url):
    return json.loads(fetch(url).decode("utf-8"))


def fetch_bili_json(url):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Referer": "https://www.bilibili.com/"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download_workbook():
    meta = fetch_json(
        f"https://drive.kdocs.cn/api/v5/links/{SHARE_CODE}?review=true"
    )
    info = fetch_json(
        f"https://www.kdocs.cn/api/office/file/{SHARE_CODE}/download"
    )
    download_url = info.get("download_url")
    if not download_url:
        raise RuntimeError("no download_url in download response")
    data = fetch(download_url)
    fileinfo = meta.get("fileinfo", {})
    return data, fileinfo


def parse_sheets(data):
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        wb = load_workbook(tmp_path, data_only=True, read_only=True)
        result = {}
        for ws in wb.worksheets:
            rows = list(ws.iter_rows(values_only=True))
            result[ws.title] = rows
        return result
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _col_to_index(col):
    num = 0
    for ch in col.upper():
        num = num * 26 + (ord(ch) - ord("A") + 1)
    return num


def _ref_rows(ref):
    """Return rows of a ref if it covers column B; otherwise None."""
    m = re.fullmatch(r"\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?", ref.strip())
    if not m:
        return None
    c1, r1, c2, r2 = m.group(1), int(m.group(2)), m.group(3), m.group(4)
    start_col = _col_to_index(c1)
    end_col = _col_to_index(c2) if c2 else start_col
    if r2 is None:
        end_row = r1
    else:
        end_row = int(r2)
    # Column B is index 2 (餐厅名称).
    if start_col <= 2 <= end_col:
        return list(range(r1, end_row + 1))
    return None


def parse_cell_histories(data):
    """Map sheet order (1-based) to {row: first-seen datetime string}."""
    histories = {}
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return histories

    names = zf.namelist()
    for idx in range(1, 20):
        path = f"xl/cellhistories/cellhistories{idx}.xml"
        if path not in names:
            continue
        first_seen = {}
        try:
            root = ET.fromstring(zf.read(path))
        except ET.ParseError:
            continue
        for ch in root:
            if ch.tag.split("}")[-1] != "cellHistory":
                continue
            dt = ch.attrib.get("dateTime")
            ref = ch.attrib.get("ref", "")
            if not dt or not ref:
                continue
            for token in ref.split():
                rows = _ref_rows(token)
                if not rows:
                    continue
                for row in rows:
                    if row not in first_seen:
                        first_seen[row] = dt
        histories[idx] = first_seen
    return histories


def clean(value):
    if value is None:
        return ""
    text = str(value).strip()
    return text


def bvid_of(url):
    m = re.search(r"BV[0-9A-Za-z]+", url or "")
    return m.group(0) if m else ""


def norm_name(name):
    text = re.sub(r"[（(【\[].*?[）)】\]]", "", name or "")
    return re.sub(r"[\s·\-\u3000]+", "", text).lower()


def find_header(rows):
    for idx, row in enumerate(rows):
        cells = [clean(c) for c in row]
        if any("序号" in c for c in cells) and any("餐厅名称" in c for c in cells):
            return idx, cells
    return None


def rows_to_records(rows):
    found = find_header(rows)
    if found is None:
        return [], []
    header_idx, headers = found
    normalized = []
    for h in headers:
        h = h.replace("人均消费(元)", "人均消费").replace("人均消费（元）", "人均消费")
        normalized.append(h.strip())
    records = []
    for offset, row in enumerate(rows[header_idx + 1 :]):
        cells = [clean(c) for c in row]
        if not any(cells):
            continue
        record = {}
        record["_row"] = header_idx + 2 + offset
        for i, h in enumerate(normalized):
            if h:
                record[h] = cells[i] if i < len(cells) else ""
        if not record.get("餐厅名称"):
            continue
        seq = record.get("序号", "")
        name = record.get("餐厅名称", "")
        if seq:
            record["_key"] = "seq:" + seq
        else:
            record["_key"] = "name:" + name
        records.append(record)
    return [h for h in normalized if h], records


def content_hash(record):
    payload = {k: v for k, v in record.items() if not k.startswith("_") and v}
    return hashlib.sha1(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def diff_records(sheet_name, old, new):
    old_map = {r["_key"]: r for r in old}
    new_map = {r["_key"]: r for r in new}
    added = []
    removed = []
    changed = []
    for key, rec in new_map.items():
        if key not in old_map:
            added.append(rec)
        elif content_hash(rec) != content_hash(old_map[key]):
            changed.append((old_map[key], rec))
    for key, rec in old_map.items():
        if key not in new_map:
            removed.append(rec)
    return added, removed, changed


def field_changes(old, new):
    changed = []
    for key in old:
        if key.startswith("_"):
            continue
        if old.get(key) != new.get(key) and (old.get(key) or new.get(key)):
            changed.append(key)
    return changed


def build_updates(old_data, new_data, counts, source_mtime_text):
    items = []
    now = datetime.now(TZ)
    if not old_data:
        parts = [f"{name} {n} 家" for name, n in counts.items() if n]
        items.append(
            {
                "time": now_text(now),
                "iso": now.isoformat(timespec="seconds"),
                "summary": "首次导入：" + "、".join(parts),
                "details": ["数据来源为金山文档《辉夜姬Invanta美食图鉴》，已生成可筛选网页。"],
                "sheet": "全部",
            }
        )
        return items

    for sheet_name in new_data:
        old_rows = old_data.get(sheet_name, [])
        new_rows = new_data[sheet_name]
        added, removed, changed = diff_records(sheet_name, old_rows, new_rows)
        if not (added or removed or changed):
            continue
        details = []
        for rec in added:
            details.append(f"新增：{rec.get('餐厅名称', '')}")
        for rec in removed:
            details.append(f"删除：{rec.get('餐厅名称', '')}")
        for old, new in changed:
            name = new.get("餐厅名称", "") or old.get("餐厅名称", "")
            fields = field_changes(old, new)
            detail = f"修改：{name}"
            if fields:
                detail += "（" + "、".join(fields) + "）"
            details.append(detail)
        summary = f"《{sheet_name}》更新：新增 {len(added)}、修改 {len(changed)}、删除 {len(removed)}"
        items.append(
            {
                "time": now_text(now),
                "iso": now.isoformat(timespec="seconds"),
                "summary": summary,
                "details": details,
                "sheet": sheet_name,
            }
        )
    return items


def load_bili_extra():
    if not os.path.exists(BILI_EXTRA_PATH):
        return []
    try:
        with open(BILI_EXTRA_PATH, "r", encoding="utf-8") as fh:
            items = json.load(fh)
    except (OSError, ValueError):
        return []
    return [item for item in items if not item.get("_skip")]


def fetch_bili_episodes():
    url = f"https://api.bilibili.com/x/web-interface/view?bvid={BILI_SEASON_BVID}"
    data = fetch_bili_json(url)
    season = data.get("data", {}).get("ugc_season") or {}
    sections = season.get("sections") or []
    episodes = []
    for section in sections:
        for ep in section.get("episodes", []):
            arc = ep.get("arc", {})
            episodes.append(
                {
                    "title": ep.get("title", ""),
                    "bvid": ep.get("bvid", ""),
                    "pubdate": arc.get("pubdate", 0),
                }
            )
    return episodes


def bili_name_from_title(title):
    text = re.sub(r"^【[^】]*】\s*", "", title or "").strip()
    if not text:
        return title
    if "：" in text:
        tail = text.split("：")[-1]
        name = re.split(r"[，,]", tail)[0].strip()
        return name or title
    if re.search(r"[，,]", text):
        head = re.split(r"[，,]", text)[0].strip()
        if len(head) <= 12 and not re.match(
            r"^(上海|试营业|中国首店|大众点评|橙|黄浦|徐汇|静安|长宁|浦东|闵行|宝山|杨浦|虹口|普陀|嘉定|金山|松江|青浦|奉贤|崇明|多少|人均|特色|因为|好吃)",
            head,
        ):
            return head
    return title


def build_bili_extra():
    overrides = {}
    for item in load_bili_extra():
        key = item.get("_key", "")
        if key.startswith("bili:"):
            overrides[key[5:]] = item

    cache = None
    if os.path.exists(BILI_CACHE_PATH):
        try:
            with open(BILI_CACHE_PATH, "r", encoding="utf-8") as fh:
                cache = json.load(fh)
        except (OSError, ValueError):
            cache = None

    episodes = None
    if cache and time.time() - cache.get("fetched_at", 0) < BILI_CACHE_SECONDS:
        episodes = cache.get("episodes") or []
    else:
        try:
            episodes = fetch_bili_episodes()
            with open(BILI_CACHE_PATH, "w", encoding="utf-8") as fh:
                json.dump(
                    {"fetched_at": time.time(), "episodes": episodes},
                    fh,
                    ensure_ascii=False,
                )
        except Exception as exc:
            if cache:
                episodes = cache.get("episodes") or []
                print("bili fetch failed, using cached episodes: %s" % exc, file=sys.stderr)
            else:
                print("bili fetch failed, using override list: %s" % exc, file=sys.stderr)
                try:
                    with open(BILI_CACHE_PATH, "w", encoding="utf-8") as fh:
                        json.dump({"fetched_at": 0, "episodes": []}, fh, ensure_ascii=False)
                except OSError:
                    pass
                return load_bili_extra()

    entries = []
    seen = set()
    for ep in reversed(episodes):
        bvid = ep.get("bvid")
        if not bvid or bvid in seen:
            continue
        seen.add(bvid)
        date_text = ""
        added_at = ""
        pubdate = ep.get("pubdate") or 0
        try:
            day = datetime.fromtimestamp(pubdate, TZ)
            date_text = day.strftime("%Y-%m-%d")
            added_at = date_text + "T12:00:00+08:00"
        except (OverflowError, OSError, ValueError):
            pass
        if date_text and date_text < BILI_START_DATE:
            continue
        if bvid in overrides:
            entries.append(overrides[bvid])
            continue
        title = ep.get("title", "")
        entries.append(
            {
                "餐厅名称": bili_name_from_title(title),
                "视频标题": title,
                "菜系/类型": "",
                "区域": "",
                "详细地址": "",
                "人均消费": "",
                "推荐菜品": "",
                "备注": ("B站投稿 · " + date_text) if date_text else "B站投稿",
                "视频链接": f"https://www.bilibili.com/video/{bvid}",
                "_key": "bili:" + bvid,
                "_addedAt": added_at,
            }
        )
    return entries


def main():
    os.makedirs(SITE_DIR, exist_ok=True)
    os.makedirs(STATE_DIR, exist_ok=True)

    data, fileinfo = download_workbook()
    raw_sheets = parse_sheets(data)
    histories = parse_cell_histories(data)
    current_month = datetime.now(TZ).strftime("%Y-%m")

    new_data = {}
    columns = {}
    for sheet_idx, (sheet_name, rows) in enumerate(raw_sheets.items(), start=1):
        cols, records = rows_to_records(rows)
        if not cols and not records:
            continue
        first_seen = histories.get(sheet_idx, {})
        for record in records:
            row = record.get("_row")
            added_at = first_seen.get(row, "")
            record["_addedAt"] = added_at
            month = added_at[:7] if added_at else ""
            record["_monthlyNew"] = bool(month and month == current_month)
        columns[sheet_name] = cols
        new_data[sheet_name] = records

    bili_extra = build_bili_extra()
    if bili_extra and "探店清单" in new_data:
        doc_bvids = {
            bvid_of(record.get("视频链接"))
            for record in new_data["探店清单"]
            if record.get("视频链接")
        }
        merged_extra = []
        for item in bili_extra:
            link = item.get("视频链接")
            if link and bvid_of(link) in doc_bvids:
                continue
            record = dict(item)
            record["_key"] = item.get("_key") or ("bili:" + link)
            added_at = item.get("_addedAt", "")
            record["_addedAt"] = added_at
            month = added_at[:7] if added_at else ""
            record["_monthlyNew"] = bool(month and month == current_month)
            merged_extra.append(record)
        if merged_extra:
            new_data["探店清单"] = merged_extra + new_data["探店清单"]

    prev_path = os.path.join(STATE_DIR, "prev.json")
    old_data = None
    if os.path.exists(prev_path):
        with open(prev_path, "r", encoding="utf-8") as fh:
            old_data = json.load(fh)

    counts = {name: len(rows) for name, rows in new_data.items()}
    source_mtime = fileinfo.get("mtime", 0)
    try:
        source_mtime_text = now_text(
            datetime.fromtimestamp(source_mtime, TZ)
        )
    except (OverflowError, OSError, ValueError):
        source_mtime_text = ""

    updates = build_updates(old_data, new_data, counts, source_mtime_text)
    updates_path = os.path.join(SITE_DIR, "updates.json")
    if os.path.exists(updates_path):
        with open(updates_path, "r", encoding="utf-8") as fh:
            existing = json.load(fh)
        existing_items = existing.get("items", [])
    else:
        existing_items = []
    combined = updates + existing_items
    updates_payload = {"items": combined[:50]}

    last_sync = datetime.now(TZ)
    meta = {
        "lastSyncText": now_text(last_sync),
        "sourceMtimeText": source_mtime_text,
        "version": fileinfo.get("fver", 0),
        "counts": counts,
        "total": sum(counts.values()),
    }

    with open(os.path.join(SITE_DIR, "data.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {"sheets": new_data, "columns": columns},
            fh,
            ensure_ascii=False,
            indent=2,
        )
    with open(os.path.join(SITE_DIR, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    with open(updates_path, "w", encoding="utf-8") as fh:
        json.dump(updates_payload, fh, ensure_ascii=False, indent=2)
    with open(prev_path, "w", encoding="utf-8") as fh:
        json.dump(new_data, fh, ensure_ascii=False, indent=2)

    print(json.dumps(meta, ensure_ascii=False))
    print(f"updates: {len(combined)} items kept")


if __name__ == "__main__":
    main()
