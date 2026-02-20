import requests
from datetime import datetime
from pathlib import Path
import html

WEEKLY_SUBREDDITS = [
    "MachineLearning",
    "productivity",
    "getdisciplined",
    "selfimprovement",
]

MONTHLY_SUBREDDITS = [
    "anki",
    "python",
    "obsidian",
    "notion",
    "superProductivity",
]

POST_LIMIT = 20
MIN_KARMA = 100
OUTPUT_DIR = Path("output")

HEADERS = {
    "User-Agent": "weekly-reddit-fetcher/1.0"
}

def current_week_tag():
    now = datetime.now()
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"

def fetch_subreddit(subreddit):
    url = f"https://www.reddit.com/r/{subreddit}/top.json"
    params = {
        "t": "week",
        "limit": 100
    }

    resp = requests.get(url, headers=HEADERS, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    posts = []
    for child in data["data"]["children"]:
        post = child["data"]
        if post["score"] > MIN_KARMA:
            posts.append({
                "title": html.escape(post["title"]),
                "link": f"https://www.reddit.com{post['permalink']}",
                "score": post["score"],
            })
        if len(posts) >= POST_LIMIT:
            break

    return posts

def generate_html(subreddit, posts, week_tag):
    lines = []
    lines.append("<html><head><meta charset='utf-8'>")
    lines.append(f"<title>r/{subreddit} – {week_tag}</title>")
    lines.append("</head><body>")
    lines.append(f"<h1>r/{subreddit}</h1>")
    lines.append(f"<p>Week: {week_tag}</p>")
    lines.append(f"<p>Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}</p>")
    lines.append("<ul>")

    for p in posts:
        lines.append(
            f"<li>"
            f"<a href='{p['link']}' target='_blank'>{p['title']}</a>"
            f" ({p['score']})"
            f"</li>"
        )

    lines.append("</ul>")
    lines.append("</body></html>")
    return "\n".join(lines)

def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    week_tag = current_week_tag()

    for sub in WEEKLY_SUBREDDITS:
        posts = fetch_subreddit(sub)
        html_content = generate_html(sub, posts, week_tag)

        filename = OUTPUT_DIR / f"{sub}_{week_tag}.html"
        filename.write_text(html_content, encoding="utf-8")

if __name__ == "__main__":
    main()
