import feedparser
from datetime import datetime
from pathlib import Path
import html

SUBREDDITS = [
    "programming",
    "MachineLearning",
    "python",
]

POST_LIMIT = 20
OUTPUT_DIR = Path("output")

def current_week_tag():
    now = datetime.now()
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"

def fetch_subreddit(subreddit):
    url = f"https://www.reddit.com/r/{subreddit}/top/.rss?t=week"
    feed = feedparser.parse(url)

    posts = []
    for entry in feed.entries[:POST_LIMIT]:
        posts.append({
            "title": html.escape(str(entry.title)),
            "link": entry.link
        })
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
            f"<li><a href='{p['link']}' target='_blank'>{p['title']}</a></li>"
        )

    lines.append("</ul>")
    lines.append("</body></html>")
    return "\n".join(lines)

def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    week_tag = current_week_tag()

    for sub in SUBREDDITS:
        posts = fetch_subreddit(sub)
        html_content = generate_html(sub, posts, week_tag)

        filename = OUTPUT_DIR / f"{sub}_{week_tag}.html"
        filename.write_text(html_content, encoding="utf-8")

if __name__ == "__main__":
    main()
