"""
fetch_timeline.py  —  Auto-updates timeline.json from RSS feeds
Runs via GitHub Actions. Groups Iran-related stories by day,
clusters similar headlines, and picks the most-covered event
per day as a timeline entry.

Coverage classification:
  3+ sources  →  fact   (widely confirmed)
  2  sources  →  govt   (corroborated)
  1  source   →  framing (single source)
"""

import json, re, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from collections import defaultdict

SOURCES = [
    {"name": "NPR News",       "url": "https://feeds.npr.org/1004/rss.xml"},
    {"name": "VOA (Iran)",     "url": "https://www.voanews.com/rss/z_ir.xml"},
    {"name": "BBC",            "url": "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"},
    {"name": "France 24",      "url": "https://www.france24.com/en/rss"},
    {"name": "Al Jazeera",     "url": "https://www.aljazeera.com/xml/rss/all.xml"},
    {"name": "Deutsche Welle", "url": "https://rss.dw.com/rdf/rss-en-world"},
]

IRAN_KEYWORDS = [
    "iran", "iranian", "tehran", "irgc", "khamenei", "nuclear",
    "jcpoa", "persian", "isfahan", "natanz", "rouhani", "raisi",
    "pezeshkian", "houthi", "hezbollah", "strait of hormuz",
    "sanctions on iran", "iran nuclear", "iran deal", "lebanon", "beirut"
]

EXCLUDE_KEYWORDS = [
    "dprk", "north korea", "venezuela", "moon mission", "football match",
    "friendly match", "barcelona", "egypt"
]

STOP_WORDS = {
    "a","an","the","in","on","at","to","for","of","and","or","is","as",
    "it","its","by","from","with","that","this","are","was","were","be",
    "been","has","have","had","but","not","says","said","over","after",
    "amid","into","will","new","iran","iranian","after","before","amid",
    "during","between","against","about","more","than","also","says",
}


def fetch_feed(source):
    try:
        req = urllib.request.Request(
            source["url"],
            headers={"User-Agent": "Mozilla/5.0 (compatible; IranDashBot/1.0)"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ✗ {source['name']}: {e}")
        return ""


def parse_date(date_str):
    try:
        return parsedate_to_datetime(date_str).astimezone(timezone.utc)
    except Exception:
        try:
            return datetime.fromisoformat(date_str).astimezone(timezone.utc)
        except Exception:
            return datetime.now(timezone.utc)


def clean(text):
    text = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', '', text)
    for ent, rep in [
        ('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'),
        ('&#39;', "'"), ('&quot;', '"'), ('&nbsp;', ' '),
    ]:
        text = text.replace(ent, rep)
    return text.strip()


def is_iran_related(text):
    t = text.lower()
    if any(bad in t for bad in EXCLUDE_KEYWORDS):
        return False
    return any(kw in t for kw in IRAN_KEYWORDS)


def extract_keywords(title):
    words = re.findall(r'\b[a-z]{4,}\b', title.lower())
    return set(w for w in words if w not in STOP_WORDS)


def similarity(t1, t2):
    k1, k2 = extract_keywords(t1), extract_keywords(t2)
    if not k1 or not k2:
        return 0.0
    return len(k1 & k2) / len(k1 | k2)


# ── Fetch stories from the past 30 days ───────────────────────
print("=" * 55)
print("fetch_timeline.py  —  Iran Conflict Timeline Builder")
print("=" * 55)

all_stories = []
cutoff = datetime.now(timezone.utc) - timedelta(days=30)

for source in SOURCES:
    print(f"\nFetching {source['name']}...")
    xml = fetch_feed(source)
    if not xml:
        continue

    count = 0
    try:
        root = ET.fromstring(xml)
    except Exception as e:
        print(f"  ✗ parse error: {e}")
        continue

    channel = root.find("channel")
    if channel is not None:
        entries = channel.findall("item")
        mode = "rss"
    else:
        ns = "{http://www.w3.org/2005/Atom}"
        entries = root.findall(f".//{ns}entry")
        mode = "atom"

    for item in entries[:60]:
        if mode == "rss":
            title = clean(item.findtext("title", default=""))
            link = clean(item.findtext("link", default=""))
            date_str = item.findtext("pubDate", default="") or item.findtext("updated", default="")
            desc = clean(item.findtext("description", default=""))
        else:
            title = clean(item.findtext(f"{ns}title", default=""))
            link_el = item.find(f"{ns}link")
            link = clean(link_el.get("href", "")) if link_el is not None else ""
            date_str = item.findtext(f"{ns}updated", default="") or item.findtext(f"{ns}published", default="")
            desc = clean(item.findtext(f"{ns}summary", default=""))

        if not title:
            continue

        combined = f"{title} {desc}"
        if not is_iran_related(combined):
            continue

        pub_date = parse_date(date_str) if date_str else datetime.now(timezone.utc)
        if pub_date < cutoff:
            continue

        all_stories.append({
            "title": title,
            "link": link,
            "date": pub_date,
            "source": source["name"],
        })
        count += 1

    print(f"  → {count} Iran/Lebanon-related stories")

print(f"\nTotal Iran stories found: {len(all_stories)}")

# ── Group by day ───────────────────────────────────────────────
by_day = defaultdict(list)
for s in all_stories:
    by_day[s["date"].strftime("%Y-%m-%d")].append(s)

# ── Cluster per day, pick most-covered event ───────────────────
timeline_events = []

for day in sorted(by_day.keys(), reverse=True):
    stories = by_day[day]
    used    = set()
    clusters = []

    for i, s in enumerate(stories):
        if i in used:
            continue
        cluster = [s]
        used.add(i)
        for j, s2 in enumerate(stories):
            if j in used or j == i:
                continue
            if similarity(s["title"], s2["title"]) > 0.25:
                cluster.append(s2)
                used.add(j)
        clusters.append(cluster)

    # Biggest cluster = most-covered story that day
    clusters.sort(key=lambda c: len(c), reverse=True)
    top         = clusters[0]
    sources_set = list(set(s["source"] for s in top))
    rep         = top[0]

    n = len(sources_set)
    event_type = "fact" if n >= 3 else ("govt" if n >= 2 else "framing")

    date_obj = datetime.strptime(day, "%Y-%m-%d")
    timeline_events.append({
        "date":        day,
        "dateDisplay": date_obj.strftime("%b %d, %Y"),
        "title":       rep["title"],
        "link":        rep["link"],
        "sources":     sources_set,
        "sourceCount": n,
        "type":        event_type,
    })

# Cap at 15 most recent events
timeline_events = timeline_events[:15]

# ── Write output ───────────────────────────────────────────────
output = {
    "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    "total":   len(timeline_events),
    "events":  timeline_events,
}

with open("timeline.json", "w") as f:
    json.dump(output, f, indent=2)

print(f"\n✓ Saved {len(timeline_events)} timeline events → timeline.json")
print()
for e in timeline_events[:5]:
    label = {"fact": "🔵", "govt": "🟠", "framing": "🟣"}.get(e["type"], "")
    srcs  = ", ".join(e["sources"])
    print(f"  {label} {e['dateDisplay']}: {e['title'][:52]}... [{srcs}]")
