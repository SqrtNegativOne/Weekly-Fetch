import html
import json
import re
import requests
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def load_list(path):
    return [l.strip() for l in Path(path).read_text().splitlines() if l.strip()]

WEEKLY_SUBREDDITS  = load_list("weekly.txt")
MONTHLY_SUBREDDITS = load_list("monthly.txt")

POST_LIMIT = 20
MIN_KARMA  = 100
OUTPUT_DIR = Path("output")
LAST_MONTHLY_PATH = Path("last_monthly.json")

HEADERS = {"User-Agent": "weekly-reddit-fetcher/1.0"}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def current_week_tag():
    now = datetime.now()
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"


def should_fetch_monthly():
    if not LAST_MONTHLY_PATH.exists():
        return True
    data = json.loads(LAST_MONTHLY_PATH.read_text())
    now = datetime.now()
    return (now.year, now.month) != (data["year"], data["month"])


def update_monthly_timestamp():
    now = datetime.now()
    LAST_MONTHLY_PATH.write_text(json.dumps({"year": now.year, "month": now.month}))


def strip_markdown(text):
    """Very lightweight markdown→plain-text for selftext previews."""
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)   # links
    text = re.sub(r'[*_~`]+', '', text)                     # emphasis/code
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)  # headings
    text = re.sub(r'\n{3,}', '\n\n', text)                  # excess blank lines
    return text.strip()

# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

def fetch_subreddit(subreddit, time_filter="week"):
    url = f"https://www.reddit.com/r/{subreddit}/top.json"
    params = {"t": time_filter, "limit": 100}

    resp = requests.get(url, headers=HEADERS, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    posts = []
    for child in data["data"]["children"]:
        post = child["data"]
        if post.get("score", 0) < MIN_KARMA:
            continue

        title = html.escape(post.get("title", ""))
        link  = f"https://www.reddit.com{post.get('permalink', '')}"
        score = post.get("score", 0)

        # Detect content type and extract embeddable content
        post_hint = post.get("post_hint", "")
        is_self    = post.get("is_self", False)
        is_gallery = post.get("is_gallery", False)

        if is_self:
            raw_text = post.get("selftext", "")[:600]
            content_type = "text"
            content = {"text": html.escape(strip_markdown(raw_text))}

        elif is_gallery:
            media_meta = post.get("media_metadata", {})
            first_id   = next(iter(media_meta), None)
            img_url    = ""
            if first_id:
                img_url = html.unescape(
                    media_meta[first_id].get("s", {}).get("u", "")
                )
            content_type = "gallery"
            content = {"url": img_url}

        elif post_hint == "image":
            images  = post.get("preview", {}).get("images", [{}])
            img_url = html.unescape(images[0].get("source", {}).get("url", ""))
            if not img_url:
                img_url = post.get("url", "")
            content_type = "image"
            content = {"url": img_url}

        elif post_hint == "hosted:video":
            video_url = (
                post.get("media", {})
                    .get("reddit_video", {})
                    .get("fallback_url", "")
            )
            content_type = "video"
            content = {"url": video_url}

        else:
            content_type = "link"
            content = {"url": post.get("url", "")}

        posts.append({
            "title":   title,
            "link":    link,
            "score":   score,
            "type":    content_type,
            "content": content,
        })

        if len(posts) >= POST_LIMIT:
            break

    return posts

# ---------------------------------------------------------------------------
# HTML generation
# ---------------------------------------------------------------------------

CSS = """
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f6f7f8;
  color: #1c1c1e;
  font-size: 15px;
  line-height: 1.5;
}
a { color: #0066cc; text-decoration: none; }
a:hover { text-decoration: underline; }

/* Sticky header */
header {
  position: sticky; top: 0; z-index: 10;
  background: #1a1a2e;
  color: #fff;
  padding: 12px 24px;
  display: flex; align-items: baseline; gap: 16px;
}
header h1 { font-size: 1.1rem; font-weight: 600; }
header span { font-size: 0.8rem; opacity: 0.65; }

/* TOC */
nav {
  max-width: 860px; margin: 20px auto 0; padding: 0 16px;
  display: flex; flex-wrap: wrap; gap: 8px;
}
nav a {
  background: #fff; border: 1px solid #dde1e7;
  border-radius: 20px; padding: 4px 14px;
  font-size: 0.8rem; color: #444;
}
nav a:hover { background: #e8eaf0; text-decoration: none; }

/* Main content */
main { max-width: 860px; margin: 20px auto 48px; padding: 0 16px; }

.period-header {
  font-size: 0.7rem; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: #888;
  margin: 36px 0 12px;
  padding-bottom: 6px; border-bottom: 1px solid #dde1e7;
}

section { margin-bottom: 32px; }
section h2 {
  font-size: 1rem; font-weight: 700; color: #333;
  margin-bottom: 10px;
}
section h2 a { color: inherit; }

/* Post card */
.card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,.08);
  padding: 14px 16px;
  margin-bottom: 10px;
}
.card-title {
  font-size: 0.95rem; font-weight: 600; line-height: 1.4;
  margin-bottom: 6px;
}
.card-title a { color: #1c1c1e; }
.card-title a:hover { color: #0066cc; }

/* Score badge */
.score {
  display: inline-block;
  font-size: 0.72rem; font-weight: 700;
  border-radius: 20px; padding: 2px 8px; margin-left: 8px;
  vertical-align: middle;
}
.score-low  { background: #e8e8e8; color: #555; }
.score-mid  { background: #ddeeff; color: #0055aa; }
.score-high { background: #ffe4cc; color: #b84600; }

/* Embedded content */
.selftext {
  font-size: 0.85rem; color: #555;
  margin-top: 6px;
  white-space: pre-wrap;
}
.card img, .card video {
  display: block; margin-top: 10px;
  max-width: 100%; border-radius: 4px;
}
.card img  { max-height: 360px; object-fit: contain; background: #f0f0f0; }
.card video { max-width: 100%; }
.ext-link {
  font-size: 0.8rem; color: #888;
  margin-top: 6px;
}
"""


def score_class(score):
    if score >= 2000:
        return "score-high"
    if score >= 500:
        return "score-mid"
    return "score-low"


def post_card_html(post):
    sc   = score_class(post["score"])
    body = (
        f'<div class="card">'
        f'<div class="card-title">'
        f'<a href="{post["link"]}" target="_blank" rel="noopener">{post["title"]}</a>'
        f'<span class="score {sc}">{post["score"]:,}</span>'
        f'</div>'
    )

    ct  = post["type"]
    cnt = post["content"]

    if ct == "text" and cnt.get("text"):
        body += f'<p class="selftext">{cnt["text"]}</p>'

    elif ct in ("image", "gallery") and cnt.get("url"):
        body += f'<img src="{cnt["url"]}" alt="" loading="lazy">'

    elif ct == "video" and cnt.get("url"):
        body += f'<video src="{cnt["url"]}" controls muted preload="none"></video>'

    elif ct == "link" and cnt.get("url"):
        try:
            from urllib.parse import urlparse
            domain = urlparse(cnt["url"]).netloc or cnt["url"]
        except Exception:
            domain = cnt["url"]
        escaped = html.escape(cnt["url"])
        body += (
            f'<div class="ext-link">'
            f'<a href="{escaped}" target="_blank" rel="noopener">{html.escape(domain)}</a>'
            f'</div>'
        )

    body += '</div>'
    return body


def generate_html(weekly: dict, monthly: dict, week_tag: str) -> str:
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    # Build TOC entries
    toc_links = []
    for sub in weekly:
        toc_links.append(f'<a href="#{sub}">{sub}</a>')
    for sub in monthly:
        toc_links.append(f'<a href="#{sub}">{sub}</a>')

    toc_html = "\n".join(toc_links)

    # Build weekly sections
    weekly_html_parts = []
    for sub, posts in weekly.items():
        cards = "".join(post_card_html(p) for p in posts)
        if not cards:
            cards = '<p style="color:#999;font-size:.85rem">No posts found.</p>'
        weekly_html_parts.append(
            f'<section id="{html.escape(sub)}">'
            f'<h2><a href="https://www.reddit.com/r/{html.escape(sub)}" '
            f'target="_blank" rel="noopener">r/{html.escape(sub)}</a></h2>'
            f'{cards}'
            f'</section>'
        )

    # Build monthly sections
    monthly_html_parts = []
    if monthly:
        monthly_html_parts.append('<h2 class="period-header">Monthly</h2>')
        for sub, posts in monthly.items():
            cards = "".join(post_card_html(p) for p in posts)
            if not cards:
                cards = '<p style="color:#999;font-size:.85rem">No posts found.</p>'
            monthly_html_parts.append(
                f'<section id="{html.escape(sub)}">'
                f'<h2><a href="https://www.reddit.com/r/{html.escape(sub)}" '
                f'target="_blank" rel="noopener">r/{html.escape(sub)}</a></h2>'
                f'{cards}'
                f'</section>'
            )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reddit Digest &middot; {week_tag}</title>
<style>
{CSS}
</style>
</head>
<body>
<header>
  <h1>Reddit Digest &middot; {week_tag}</h1>
  <span>generated {now_str}</span>
</header>
<nav>
{toc_html}
</nav>
<main>
{''.join(weekly_html_parts)}
{''.join(monthly_html_parts)}
</main>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    week_tag   = current_week_tag()
    do_monthly = should_fetch_monthly()

    weekly_data  = {sub: fetch_subreddit(sub, "week") for sub in WEEKLY_SUBREDDITS}
    monthly_data = {}
    if do_monthly:
        monthly_data = {sub: fetch_subreddit(sub, "month") for sub in MONTHLY_SUBREDDITS}
        update_monthly_timestamp()

    page = generate_html(weekly_data, monthly_data, week_tag)
    out  = OUTPUT_DIR / f"digest_{week_tag}.html"
    out.write_text(page, encoding="utf-8")
    print(f"Written: {out}")


if __name__ == "__main__":
    main()
