<i>"Why is there a like button for the posts you receive on your feed? If you don't like it, it shouldn't be on your feed."</i>

Get the top posts from Reddit, Instagram, Tumblr, Bluesky, and Mastodon on a schedule. View on your terms. Swipe through each post one-at-a-time, be able to take notes on each instead of facing a barrage of un-actionable information through scrolling. All data (posts, notes) stored locally.

Currently Windows only.

## Install

Download the latest `.zip` from [Releases](../../releases), unzip anywhere, and double-click `WeeklyFetch.exe`.

## Develop from source

```bash
# Requires Python 3.13+ and uv
uv sync
uv run python app.py
```

## How it works

On first launch it will inject itself into your task scheduler. You select the subreddits or accounts you want to watch, and when. Set Karma / likes limit for each. Set a schedule on when to go through them (daily, weekly, monthly, xth of every month etc.): it will download all posts and show them to you on those dates only.


## Syncing across machines

Put `data/` (or wherever `data_dir` points in Settings) in a Syncthing folder. Posts and notes sync automatically. The app reads from whatever DB is there.