"""
ClearView Iran Dashboard — Automated News Fetcher
Runs on GitHub Actions every hour. Pulls RSS feeds, filters for
Iran-related stories, and writes news.json.
"""

import json
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
import re

# ── RSS FEED SOURCES ───────────────────────────────────────────────────────────
# Reuters and AP block GitHub's IPs. Replaced with equivalent sources
# that have open RSS access.
SOURCES = [
    {
        "name": "NPR News",
        "region": "us",
        "color": "#3a86ff",
        "bias": "Low",
        "url": "https://feeds.npr.org/1004/rss.xml",
    },
    {
        "name": "VOA (Iran)",
        "region": "us",
        "color": "#3a86ff",
        "bias": "Low-Med",
        "url": "https://www.voanews.com/rss/z_ir.xml",
    },
    {
        "name": "BBC",
        "region": "eu",
        "color": "#06d6a0",
        "bias": "Low-Med",
        "url": "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
    },
    {
        "name": "France 24",
        "region": "eu",
        "color": "#06d6a0",
        "bias": "Low-Med",
        "url": "https://www.france24.com/en/rss",
    },
    {
        "name": "Al Jazeera",
        "region": "me",
        "color": "#ffbe0b",
        "bias": "Medium",
        "url": "https://www.aljazeera.com/xml/rss/all.xml",
    },
    {
        "name": "Deutsche Welle",
        "region": "eu",
        "color": "#06d6a0",
        "bias": "Low",
        "url": "https://rss.dw.com/rdf/rss-en-world",
    },
    # ── NEW NON-WESTERN SOURCES ────────────────────────────────────────────────
    {
        "name": "TASS",
        "region": "ru",
        "color": "#cc4444",
        "bias": "Very High",
        "url": "https://tass.com/rss/v2.xml",
    },
    {
        "name": "Xinhua",
        "region": "cn",
        "color": "#cc4444",
        "bias": "High",
        "url": "https://www.xinhuanet.com/english/rss/worldrss.xml",
    },
    {
        "name": "Dawn",
        "region": "me",
        "color": "#22bb77",
        "bias": "Low-Med",
        "url": "https://www.dawn.com/feeds/world",
    },
    {
        "name": "Arab News",
        "region": "me",
        "color": "#ffbe0b",
        "bias": "High",
        "url": "https://www.arabnews.com/rss.xml",
    },
    {
        "name": "The Hindu",
        "region": "me",
        "color": "#22bb77",
        "bias": "Low-Med",
        "url": "https://www.thehindu.com/news/international/feeder/default.rss",
    },
    {
        "name": "Gulf News",
        "region": "me",
        "color": "#ffbe0b",
        "bias": "Medium",
        "url": "https://gulfnews.com/rss/world",
    },
]

# ── IRAN-RELATED KEYWORDS ──────────────────────────────────────────────────────
IRAN_KEYWORDS = [
    "iran", "iranian", "tehran", "irgc", "quds", "khamenei",
    "nuclear deal", "jcpoa", "sanctions", "strait of hormuz",
    "hezbollah", "houthi", "proxy", "persian gulf", "revolutionary guard",
    "uranium enrichment", "natanz", "fordow", "arak", "bushehr",
    "raisi", "pezeshkian", "zarif", "mojtaba",
]

def is_iran_related(text):
    lowered = text.lower()
    return any(kw in lowered for kw in IRAN_KEYWORDS)

def clean_html(text):
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&quot;", '"', text)
    text = re.sub(r"&#39;", "'", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()

def fetch_feed(source):
    items = []
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; ClearViewBot/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
    }
    try:
        req = urllib.request.Request(source["url"], headers=headers)
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
        root = ET.fromstring(raw)

        # RSS 2.0
        channel = root.find("channel")
        if channel is not None:
            entries = channel.findall("item")
        else:
            # Atom
            ns = "{http://www.w3.org/2005/Atom}"
            entries = root.findall(f".//{ns}entry")

        found = 0
        for item in entries[:50]:
            def get(tag, atom_tag=None):
                el = item.find(tag)
                if el is None and atom_tag:
                    el = item.find(atom_tag)
                if el is not None:
                    return el.text or el.get("href", "") or ""
                return ""

            title = clean_html(get("title", "{http://www.w3.org/2005/Atom}title"))
            link  = get("link", "{http://www.w3.org/2005/Atom}link")
            desc  = clean_html(get("description", "{http://www.w3.org/2005/Atom}summary"))
            date  = get("pubDate", "{http://www.w3.org/2005/Atom}updated")

            # VOA feeds sometimes put content in media:description
            if not desc:
                for child in item:
                    if "description" in child.tag.lower() or "summary" in child.tag.lower():
                        if child.text:
                            desc = clean_html(child.text)
                            break

            if not title:
                continue

            combined = f"{title} {desc}"
            if is_iran_related(combined):
                items.append({
                    "title":       title,
                    "link":        link,
                    "description": desc[:280] + ("..." if len(desc) > 280 else ""),
                    "date":        date[:16] if date else "",
                    "source":      source["name"],
                    "region":      source["region"],
                    "color":       source["color"],
                    "bias":        source["bias"],
                })
                found += 1

        print(f"  Found {found} Iran-related stories")

    except Exception as e:
        print(f"  ERROR: {e}")

    return items


def main():
    print(f"\n{'='*55}")
    print(f"ClearView Fetch — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*55}")

    all_items = []
    for source in SOURCES:
        print(f"\n-> Fetching {source['name']} ({source['url'][:50]}...)")
        items = fetch_feed(source)
        all_items.extend(items)

    # Deduplicate by title
    seen = set()
    unique = []
    for item in all_items:
        key = re.sub(r"\W+", " ", item["title"].lower()).strip()[:80]
        if key not in seen:
            seen.add(key)
            unique.append(item)

    # Sort: US first, then EU, then ME/others
    order = {"us": 0, "eu": 1, "me": 2, "ru": 3, "cn": 4}

    # Cap: max 15 stories per source, 60 total
    from collections import defaultdict
    source_counts = defaultdict(int)
    capped = []
    for item in unique:
        src = item.get("source", "")
        if source_counts[src] < 15:
            source_counts[src] += 1
            capped.append(item)
    unique = capped[:60]

    unique.sort(key=lambda x: order.get(x["region"], 9))

    output = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "total":   len(unique),
        "stories": unique,
    }

    with open("news.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Saved {len(unique)} stories to news.json")
    print(f"{'='*55}\n")


if __name__ == "__main__":
    main()