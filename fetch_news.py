"""
ClearView Iran Dashboard — Automated News Fetcher
Runs on GitHub Actions every hour. Pulls RSS feeds from Reuters, BBC,
Al Jazeera, and AP, filters for Iran-related stories, and writes news.json.
"""

import json
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
import re

# ── RSS FEED SOURCES ──────────────────────────────────────────────────────────
SOURCES = [
    {
        "name": "Reuters",
        "region": "us",
        "color": "#3a86ff",
        "bias": "Low",
        "url": "https://feeds.reuters.com/reuters/worldNews",
    },
    {
        "name": "BBC",
        "region": "eu",
        "color": "#06d6a0",
        "bias": "Low-Med",
        "url": "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
    },
    {
        "name": "Al Jazeera",
        "region": "me",
        "color": "#ffbe0b",
        "bias": "Medium",
        "url": "https://www.aljazeera.com/xml/rss/all.xml",
    },
    {
        "name": "AP News",
        "region": "us",
        "color": "#3a86ff",
        "bias": "Low",
        "url": "https://rsshub.app/apnews/topics/apf-intlnews",
    },
]

# ── IRAN-RELATED KEYWORDS ─────────────────────────────────────────────────────
IRAN_KEYWORDS = [
    "iran", "iranian", "tehran", "irgc", "quds", "khamenei", "rouhani",
    "raisi", "nuclear deal", "jcpoa", "sanctions", "strait of hormuz",
    "hezbollah", "houthi", "proxy", "persian gulf", "revolutionary guard",
    "zarif", "uranium enrichment", "natanz", "fordow", "arak", "bushehr",
]

def is_iran_related(text):
    """Return True if the text contains any Iran-related keyword."""
    lowered = text.lower()
    return any(kw in lowered for kw in IRAN_KEYWORDS)

def clean_html(text):
    """Strip HTML tags from a string."""
    if not text:
        return ""
    return re.sub(r"<[^>]+>", "", text).strip()

def fetch_feed(source):
    """Fetch and parse an RSS feed, return Iran-related items."""
    items = []
    headers = {"User-Agent": "ClearView-IranDashboard/1.0"}
    try:
        req = urllib.request.Request(source["url"], headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read()
        root = ET.fromstring(raw)
        ns = ""
        # Handle both RSS 2.0 and Atom
        channel = root.find("channel")
        entries = channel.findall("item") if channel is not None else root.findall(".//{http://www.w3.org/2005/Atom}entry")

        for item in entries[:40]:  # Check first 40 items per feed
            title_el = item.find("title")
            link_el  = item.find("link")
            desc_el  = item.find("description") or item.find("{http://www.w3.org/2005/Atom}summary")
            date_el  = item.find("pubDate") or item.find("{http://www.w3.org/2005/Atom}updated")

            title = clean_html(title_el.text if title_el is not None else "")
            link  = link_el.text if link_el is not None else ""
            desc  = clean_html(desc_el.text if desc_el is not None else "")
            date  = date_el.text if date_el is not None else ""

            # For Atom feeds link may be an attribute
            if not link and link_el is not None:
                link = link_el.get("href", "")

            combined = f"{title} {desc}"
            if title and (is_iran_related(combined) or source["name"] == "Al Jazeera"):
                # For Al Jazeera (Middle East-focused), include all items then filter lightly
                if source["name"] == "Al Jazeera" and not is_iran_related(combined):
                    continue
                items.append({
                    "title": title,
                    "link": link,
                    "description": desc[:300] + ("..." if len(desc) > 300 else ""),
                    "date": date,
                    "source": source["name"],
                    "region": source["region"],
                    "color": source["color"],
                    "bias": source["bias"],
                })

    except Exception as e:
        print(f"  ⚠ Error fetching {source['name']}: {e}")

    return items

def main():
    print(f"\n{'='*50}")
    print(f"ClearView News Fetch — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*50}")

    all_items = []
    for source in SOURCES:
        print(f"\n→ Fetching {source['name']}...")
        items = fetch_feed(source)
        print(f"  Found {len(items)} Iran-related stories")
        all_items.extend(items)

    # Deduplicate by title similarity
    seen_titles = set()
    unique_items = []
    for item in all_items:
        normalized = re.sub(r"\W+", " ", item["title"].lower()).strip()
        if normalized not in seen_titles:
            seen_titles.add(normalized)
            unique_items.append(item)

    # Sort by source for grouping (Reuters, AP first, then BBC, Al Jazeera)
    source_order = {"Reuters": 0, "AP News": 1, "BBC": 2, "Al Jazeera": 3}
    unique_items.sort(key=lambda x: source_order.get(x["source"], 99))

    output = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "total": len(unique_items),
        "stories": unique_items,
    }

    with open("news.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Saved {len(unique_items)} stories to news.json")
    print(f"{'='*50}\n")

if __name__ == "__main__":
    main()
