# Daily update

How the site is refreshed each morning. The scheduled Claude task follows these steps in order.
Run every command from this folder.

## 1. Gather today's news

Read the public feeds and section pages of these outlets, and nothing else:

- NPR: https://feeds.npr.org/1004/rss.xml (world), https://feeds.npr.org/1006/rss.xml (business), https://feeds.npr.org/1007/rss.xml (science), https://feeds.npr.org/1019/rss.xml (technology)
- Al Jazeera: https://www.aljazeera.com/xml/rss/all.xml
- France 24: https://www.france24.com/en/rss
- ABC News (Australia), sport: https://www.abc.net.au/news/feed/2942460/rss.xml

Only use items from the last 48 hours for `stories` and `sport`. `lighter` may go back a week.
Open the article itself for any story you write background for.

## 2. Write `data/latest.json`

Replace the whole file. Keep the same shape as the current file:

- `date` (YYYY-MM-DD, today in UTC), `snapshot` (ISO time you gathered the news), `outlets` (the outlets you used).
- `stories`: 20 to 30 stories. Exactly one has `"lead": "main"` and two have `"lead": "side"`: the three most important stories in the world today, not the most clicked.
  Each story has `id`, `topic` (Conflict, Politics, Business, Tech, Science, Health, Climate, Culture), `region` (Europe, Middle East, Africa, Asia-Pacific, Americas, Global), `city`, `tz` (IANA zone, `"UTC"` for worldwide, `null` for none), `lat`/`lon` (or both `null`), `title`, `summary`, `background`, optional `thread`, and `sources` (outlet, original headline, https url, ISO time).
- `lighter`: 6 to 8 good-news, science or curious stories.
- `sport`: 5 to 8 results or big sport stories.

Writing rules:

- Titles and summaries are your own plain words, not copied text. Quote original headlines only in `sources`.
- Every fact must come from the linked reports. Don't add numbers, names or claims they don't contain.
- `background` ("How we got here") explains the history and context in 2 to 4 sentences, for someone who hasn't followed the story. Use only well-established facts; when unsure, leave it out.
- Mark key terms in `summary` and `background` as `[[term-id|shown words]]`. Add any new term to `data/terms.json` with a one- or two-sentence plain-English definition. Never delete terms.
- Be neutral. Attribute claims ("officials say", "according to") instead of stating them as fact.

## 3. Update `data/threads.json`

For each ongoing thread with news today, add new events at the end (dates in order, each with its source).
Start a new thread when a story has clearly become a running one. Keep threads that went quiet.

## 4. Check and publish

```
npm run validate
```

Fix every problem it reports and run it again until it says OK. Then save a copy of the day:

```
copy data\latest.json data\archive\<date>.json
git add -A
git commit -m "News for <date>"
git push
```

## 5. Email digest

```
npm run digest -- <site address>
```

Then create a Gmail draft (do not send it) addressed to the site owner, with the subject from
`digest/subject.txt` and the body from `digest/email.html`. The owner reviews it, adds recipients and sends it.
