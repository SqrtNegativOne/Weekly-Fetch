<i>"Why is there a like button for the posts you receive on your feed? If you don't like it, it shouldn't be on your feed."</i>

A slower, systematic, and more thoughtful approach to social media.

- **Centralised**. Get posts from Reddit, Instagram, Tumblr, Twitter, Bluesky and Mastodon. All data is stored locally.
- **Flexible**. Set different schedules for each source. The name is a misnomer.
- **Intentional**. Take notes, add todos for each post, take breaks.
- **Focused**. Swipe instead of facing a constant unlimited barrage of un-actionable information through scrolling.

Currently Windows only.

## Install

Download the latest `.zip` from [Releases](../../releases), unzip anywhere, and double-click `WeeklyFetch.exe`.

## Develop from source

```bash
# Requires Python 3.13+ and uv
uv sync
uv run python app.py
```

## Features

- **No ads, no algorithms.** Posts are fetched directly from each platform. There is no algorithmic feed deciding what you see, and nobody is profiting from your attention.

- **Your data stays on your machine.** Everything is stored in a local SQLite database. Your reading habits, notes, and browsing history belong to you.

- **One card at a time.** Infinite scroll is designed to suppress your sense of time passing. Seeing one post at a time lets you actually sit with it, and you end up reading more carefully and remembering more of what you read.

- **Notes and todos on every post.** Each card has a sidebar for freeform notes and todos. Writing your own words about what you read activates the generation effect, which dramatically improves retention compared to passively scrolling past things. Once you write something, the post auto-archives into an inbox-zero workflow.

- **Searchable archive.** Every post you've ever seen is saved alongside your notes and todos. You can search by title, filter by platform, and browse separate tabs for notes and todos. When you vaguely remember something from a few weeks ago, you can find it and see what you thought about it at the time.

- **Scheduled delivery.** Each source fetches on its own schedule (every Saturday, every 3 days, 1st of the month, etc.). Content arrives when it's due, so the app can't become a reflex you reach for out of boredom.

- **Quality thresholds.** The more information we have access to, the worse our decision-making actually gets, because it becomes harder to find the information that matters. Each source has a minimum score filter so only posts the community actually valued make it through to you.

- **20-20-20 eye breaks.** After 20 minutes of reading, the app pauses and asks you to look 20 feet away for 20 seconds. It's also a chance to check in with yourself and decide whether you actually want to keep going or were just being carried along by momentum.

- **Keyboard-driven.** Navigation uses deliberate keypresses (`h`/`l` prev/next, `j`/`k` scroll, `Enter` archive, `Ctrl+N` notes). This keeps you physically engaged with what you're reading. You are actively choosing to advance through your feed, which makes you more present with each post.

- **Reading time estimates.** Each session opens with a cover card showing how many posts are pending and how long they'll take to read. If the number keeps growing, it's a signal that you're spreading yourself too thin across too many sources and should consider pruning some.

- **Usage dashboard.** Shows time spent per source, posts viewed, and recent session history, so you can see where your attention is actually going and decide whether each source is worth keeping.

- **Review card.** After your last post, a review card gathers all your pending notes and todos in one place so you can decide what needs doing and archive the rest.

- **Undo.** Ctrl+Z reverses your last action, whether it was an archive, a note edit, or a todo edit.

- **Native notifications.** When a scheduled fetch finds new posts, you get a single Windows toast notification letting you know new content is ready.