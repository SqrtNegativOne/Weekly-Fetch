import json
from datetime import datetime

from schedule import schedule_label


def generate_html(results: dict, schedule_map: dict, week_tag: str) -> str:
    """Build the full HTML digest page.

    Args:
        results:      {source_name: [post, ...]}
        schedule_map: {source_name: schedule_dict}  (used to derive period labels)
        week_tag:     ISO week string like "2026-W10"
    """
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    # Source summary for the cover card.
    source_summary = []
    for name, posts in results.items():
        platform = posts[0]["platform"] if posts else "reddit"
        sched    = schedule_map.get(name, {})
        source_summary.append({
            "name":     name,
            "period":   schedule_label(sched),
            "count":    len(posts),
            "platform": platform,
        })

    total_posts = sum(s["count"] for s in source_summary)

    # Flat post list: cover → posts → notes summary
    all_posts: list = [{
        "type":        "cover",
        "title":       "Weekly Digest",
        "link":        "__cover__",
        "week_tag":    week_tag,
        "generated":   now_str,
        "subreddits":  source_summary,   # kept as "subreddits" for JS back-compat
        "total_posts": total_posts,
    }]
    for name, posts in results.items():
        period = schedule_label(schedule_map.get(name, {}))
        for p in posts:
            all_posts.append({**p, "subreddit": name, "period": period})
    all_posts.append({"type": "notes_summary", "title": "Your Notes",
                      "link": "__notes__"})

    posts_json = json.dumps(all_posts, ensure_ascii=False).replace("</", "<\\/")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly Digest &middot; {week_tag}</title>
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
      <textarea id="notes" placeholder="Click to start a bullet list&hellip;"></textarea>
    </div>
  </div>
</div>

<script type="application/json" id="posts-data">{posts_json}</script>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="../src/digest.js"></script>
</body>
</html>"""
