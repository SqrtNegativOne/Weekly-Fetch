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

- No ads. No one profits from your attention.
- No algorithms; you decide what reaches your inbox, and how long you want to spend doing this.
- Instead, there is (very flexible) scheduled delivery. Instead of scrolling whenever you're bored you can carve out specific times you want to sit down and read.
- Quality thresholds. Algorithms intentionally intersperse shitty content in the middle of good content to create **variable rewards**, which keeps you scrolling for longer. If something isn't good, it shouldn't be on your feed man. Stop watching this shit
- All data stored on machine in a SQL for later reference, even if the post gets deleted or the site gets destroyed.
- You swipe through one card at a time, because it's calmer, more focused, doesn't suppress your sense of time passing, making reading more intentional, and scrolling makes my head hurt.
- You can take notes on every post, to take advantage of the generation effect and make sure you actually remember what you're scrolling. Unless you're using the app to watch Reels or memes for some reason in which case you can just skip this by pressing the Enter key.
- Take todos on every post, which you can export to your real task management system easily. Separates referential information with actionable information.
- Each note and todo is bullet-pointed to ensure the atomicity of each is reflected.
- Keyboard-driven, because I got tha vim-user dawg in me. Makes the UI look better and forces you to Lock In kinda.
- 20-20-20 eye breaks, not because of eyes or anything but because even swiping through a waterfall of random content can cause brainfog eventually.
- Reading time estimates to inform you if you're spreading yourself too thin and you should consider pruning some shittiness out of your life.
- Inspired by Palantir, this also has a Usage dashboard to keep track on how long you spend on each post, source, site etc.