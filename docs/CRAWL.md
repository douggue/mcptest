# Tech doc: the recommendation crawl

How the competitor map is gathered, what evidence that is based on, and what it costs.

## Summary

The map can be built from two unauthenticated request types against YouTube's
internal web API ("InnerTube"), the same API the youtube.com site uses:

| Request              | InnerTube endpoint         | What it returns                                                                                                    |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Channel "Videos" tab | `browse` (+ continuations) | 30 long-form videos per page: id, title, rounded views, relative date, duration. Header: subscribers, video count. |
| Watch page sidebar   | `next`                     | About 20 recommended videos, each with channel name, channel id, handle, rounded views, relative date.             |

No API key, login or cookies are needed. The open-source client
[`youtubei.js`](https://www.npmjs.com/package/youtubei.js) (MIT, v18.3.0) wraps both.

## Evidence

### From Makina's own export (`America Invents map.txt`)

| Observation in the export                                                            | What it implies                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| "Video dates are approximate, as YouTube gives them: _2 weeks ago_"                  | Data comes from the web UI's list views. The official Data API returns exact timestamps.         |
| View counts are rounded (`4.2M`, `133K`)                                             | Same: list views return short counts.                                                            |
| "Views are of long videos, Shorts left out"                                          | The channel _Videos_ tab, which is separate from the _Shorts_ tab.                               |
| `Subscribers: hidden`                                                                | Scraped header text, not an API field.                                                           |
| "A channel recommends another when YouTube shows the other's videos next to its own" | The watch-page sidebar. The official API removed related-video lookup.                           |
| Recommendation shares are multiples of 1/10, 1/9, 1/7, 1/5, 1/3                      | About 10 recent videos sampled per channel (fewer if the channel has fewer).                     |
| At most 15 channels per "Recommends" line; minimum share is 2 hits                   | Top 15 kept, with a floor of two appearances (waived for a 3-video channel).                     |
| Only the centre and the six 1-step channels have a "Recommends" line                 | Sidebars are read for depth 0 and 1 only; depth-2 channels get a channel-page read.              |
| Up to 100 videos per channel                                                         | First page plus continuations, capped.                                                           |
| `Views, last 30 days: 0` for a channel with 100 old videos                           | The figure is the sum of views on videos _published_ in the last 30 days, not true 30-day views. |

### Live probe (run 2026-11-20)

Three requests against a large public channel through `youtubei.js`, no credentials:

- Channel header returned `21.5M subscribers` and `552 videos`.
- Videos tab returned 30 items with a continuation; each item carried
  `["1.5M", "1d ago"]`, `["20M", "2w ago"]` and a duration overlay. This is the
  same rounding and relative dating as the export.
- Sidebar returned 20 items across 14 channels, each with channel name, a
  `UC…` channel id and an `/@handle`. Seven of the 20 were the channel's own videos.

So the fields, the precision and the page sizes all match.

## Algorithm

```
crawl(center, depth = 2, K = 10, TOP = 15):
  queue = [(center, 0)]
  for (channel, d) in queue:
    page = fetchChannelVideos(channel, max = 100)        # browse + continuations
    store(channel, page.videos)
    if d < depth:
      sample = newest K long-form videos
      hits = {}                                          # other channel -> set of sampled videos
      for v in sample:
        for rec in fetchSidebar(v):                      # next
          if rec.channel != channel: hits[rec.channel].add(v)
      floor = 2 if len(sample) >= 4 else 1
      edges = top TOP of hits where |hits| >= floor, by |hits| desc
      store edge(channel -> other, share = |hits| / len(sample))
      enqueue (other, d + 1) for each new other
```

Depth-2 channels are fetched but not expanded, which is why they have no outgoing edges.

## Request budget

For a map the size of the export (1 + 6 + 81 = 88 channels):

| Step                                            | Requests               |
| ----------------------------------------------- | ---------------------- |
| Channel pages, 88 channels at 1 to 4 pages each | 90 to 350              |
| Sidebars, 7 channels at up to 10 videos         | about 65               |
| **Total**                                       | **roughly 150 to 420** |

At 2 concurrent requests with a 300 to 600 ms jittered delay this is 1 to 4 minutes,
which matches the time Makina's own search takes.

## Known weaknesses of this method

- **Noise for small channels.** A channel with three uploads has a sidebar full of
  generic popular videos. In the export, a tech reviewer, a firearms channel and a
  wildlife channel were all "1 step" from a brand-new invention channel. Only about
  6 of 88 channels shared its title format. The system design adds a relevance
  filter and search-based discovery to fix this.
- **Signed-out recommendations vary** by region and over time. Fix a region and
  language per map and store the crawl date on every edge.
- **Relative dates lose precision.** Anything older than a month is known only to
  the month. Keep the raw text and a precision flag; never present these as exact.
- **Rounded views.** `1.5M` could be 1.45M to 1.55M. Fine for outlier scoring.
- **Schema drift.** YouTube changes list-item formats without notice (the probe hit
  the newer `LockupView` shape). Parse defensively and keep fixtures.

## Risk: terms of service

This is automated access to youtube.com outside the official API, which YouTube's
Terms of Service do not permit. It is widely done, but it carries real risk:
blocked IPs, CAPTCHA walls, sudden breakage, and exposure if the product is sold.

Mitigations built into the design:

- All YouTube access sits behind one `YouTubeSource` interface with two
  implementations: `InnertubeSource` (this crawl) and `DataApiSource` (official
  API for channel and video data). Everything except sidebar edges works on the
  official API alone.
- Low request rates, caching (videos 24 h, edges 7 d), no logged-in sessions, no
  media downloads.
- An optional proxy for YouTube (`JGTUBE_YOUTUBE_PROXY`, see SYSTEM_DESIGN.md)
  changes only the address requests come from, never their number or pace.
- Search-based competitor discovery works without sidebars, so the product
  degrades to "no map" rather than "no product".
- Get legal advice before charging money for a product that depends on this.
