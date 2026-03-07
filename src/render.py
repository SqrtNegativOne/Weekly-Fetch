import json
from datetime import datetime


def generate_html(weekly: dict, monthly: dict, week_tag: str) -> str:
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    # Subreddit summary for the cover card
    subreddit_summary = []
    for sub, posts in weekly.items():
        subreddit_summary.append({"name": sub, "period": "weekly",  "count": len(posts)})
    for sub, posts in monthly.items():
        subreddit_summary.append({"name": sub, "period": "monthly", "count": len(posts)})
    total_posts = sum(s["count"] for s in subreddit_summary)

    # Flat post list: cover → posts → notes summary
    all_posts: list = [{
        "type":        "cover",
        "title":       "Reddit Digest",
        "link":        "__cover__",
        "week_tag":    week_tag,
        "generated":   now_str,
        "subreddits":  subreddit_summary,
        "total_posts": total_posts,
    }]
    for sub, posts in weekly.items():
        for p in posts:
            all_posts.append({**p, "subreddit": sub, "period": "weekly"})
    for sub, posts in monthly.items():
        for p in posts:
            all_posts.append({**p, "subreddit": sub, "period": "monthly"})
    all_posts.append({"type": "notes_summary", "title": "Your Notes", "link": "__notes__"})

    posts_json = json.dumps(all_posts, ensure_ascii=False).replace("</", "<\\/")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reddit Digest &middot; {week_tag}</title>
<script>
MathJax = {{
  tex: {{
    inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
    displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
  }},
  startup: {{ typeset: false }}
}};
</script>
<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
<link rel="stylesheet" href="../src/digest.css">
</head>
<body>

<!-- Animated blob background (sits behind everything via z-index) -->
<div id="bg">
  <div id="blob1" class="blob"></div>
  <div id="blob2" class="blob"></div>
  <div id="blob3" class="blob"></div>
</div>

<div id="app">
  <div id="topbar">
    <div id="tabs"></div>
    <div id="topbar-progress"></div>
  </div>

  <div id="layout">
    <div id="card-area">
      <div id="card-scroll">
        <div id="card"></div>
        <div id="card-comments"></div>
      </div>
      <div id="nav-bar">
        <button id="btn-prev" onclick="navigate(-1)">&larr; Prev</button>
        <span id="nav-label"></span>
        <button id="btn-next" onclick="navigate(1)">Next &rarr;</button>
      </div>
    </div>

    <div id="sidebar">
      <div id="sidebar-header">Notes</div>
      <div id="notes-post-title"></div>
      <textarea id="notes" placeholder="Jot thoughts here&hellip; auto-saved per post"></textarea>
    </div>
  </div>
</div>

<script type="application/json" id="posts-data">{posts_json}</script>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="../src/digest.js"></script>
</body>
</html>"""
