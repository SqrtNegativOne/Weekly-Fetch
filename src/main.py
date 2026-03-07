from tqdm import tqdm

from config import MONTHLY_SUBREDDITS, OUTPUT_DIR, POST_LIMIT, WEEKLY_SUBREDDITS
from fetch import fetch_subreddit
from render import generate_html
from schedule import current_week_tag, should_fetch_monthly, update_monthly_timestamp


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    week_tag   = current_week_tag()
    do_monthly = should_fetch_monthly()

    all_subs = list(WEEKLY_SUBREDDITS) + (list(MONTHLY_SUBREDDITS) if do_monthly else [])
    # +1 per subreddit for the initial top-posts listing request
    total_steps = (POST_LIMIT + 1) * len(all_subs)

    bar_format = "{l_bar}{bar}| {n}/{total} [{elapsed}<{remaining}]"

    with tqdm(total=total_steps, unit="req", bar_format=bar_format, dynamic_ncols=True) as progress:
        weekly_data = {sub: fetch_subreddit(sub, "week", progress) for sub in WEEKLY_SUBREDDITS}

        monthly_data = {}
        if do_monthly:
            monthly_data = {sub: fetch_subreddit(sub, "month", progress) for sub in MONTHLY_SUBREDDITS}
            update_monthly_timestamp()

    page = generate_html(weekly_data, monthly_data, week_tag)
    out  = OUTPUT_DIR / f"digest_{week_tag}.html"
    out.write_text(page, encoding="utf-8")
    print(f"Written: {out}")


if __name__ == "__main__":
    main()
