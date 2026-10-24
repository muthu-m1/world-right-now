# Daily update

How the site is refreshed each morning. The scheduled Claude task follows these steps in order.
Run every command from this folder.

## 1. Gather today's news

```
npm run feeds
```

This reads every feed in `data/sources.json` (international, regional, national and local outlets in every region,
including Indian state and city pages and African, Asian, Latin American and rural outlets). It writes:

- `.feeds/digest.md`: the last 48 hours of headlines, grouped by region and outlet, with links and short descriptions. Read all of it before choosing stories. It is long; read it in parts.
- `data/wire.json`: a rolling week of every headline, tagged with its outlet's place, which the site's search uses. Don't edit it by hand.

Use only items from the digest (and the articles they link to). Only use items from the last 48 hours for `stories` and `sport`; `lighter` may go back a week.
Open the article itself for any story you write background for. If a feed in the digest says FAILED, carry on with the others and mention it in your summary.
To add a source, add it to `data/sources.json` and check it with `npm run feeds`.

## 2. Write `data/latest.json`

Replace the whole file. Keep the same shape as the current file:

- `date` (YYYY-MM-DD, today in UTC), `snapshot` (ISO time you gathered the news), `outlets` (the outlets you used).
- `stories`: two kinds, in one list.
  - 20 to 30 main stories (`"scale": "international"` or `"national"`). Exactly one has `"lead": "main"` and two have `"lead": "side"`: the three most important stories in the world today, not the most clicked.
  - 25 to 40 local stories (`"scale": "local"`): news from towns, villages, districts, rural areas and city neighbourhoods, mostly from the local and national outlets in the digest. They appear in the site's "Local news from around the world" section, by region. Spread them across the world: at least 6 from Africa (including places outside capital cities), at least 6 from India (several states, cities and rural districts), and at least 3 each from the rest of Asia and the Pacific, the Americas and Europe, plus the Middle East when the digest has some. Prefer everyday life: water, roads, schools, farming and harvests, weather and floods, health clinics, local government and elections, wildlife, culture and community. Not just conflict or crime.
  - Across the whole list, keep conflict stories under about a third.
  Each story has `id`, `scale`, `topic` (Conflict, Politics, Business, Tech, Science, Health, Climate, Culture, Community, Farming, Weather, Nature), `region` (Europe, Middle East, Africa, Asia-Pacific, Americas, Global), `city`, `country`, optional `state`, optional `places`, `tz` (IANA zone, `"UTC"` for worldwide, `null` for none), `lat`/`lon` (or both `null`), `title`, `summary`, `background` (optional for local stories), optional `thread`, and `sources` (outlet, original headline, https url, ISO time).
  For local stories, `city` is the most specific place the report names (a neighbourhood like "Ashok Nagar, Chennai", a village, a district or a lake), and `places` lists the wider names people might search for (the city, district, state and other names for the place). Readers' letters and opinion pieces are fine but must say so ("In a letter to The Hindu, a reader says…").
  The place fields power the site's search: `country` is the country the dateline is in (`"Worldwide"` for global stories), `state` is the US state, province or region when there is a clear one, and `places` lists other countries or states the story is mainly about (for example a US story about Canada gets `"places": ["Canada"]`).
  Keep titles under about 90 characters: the top stories are set large.
- `lighter`: 6 to 8 good-news, science or curious stories, with the same place fields where they apply.
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
Keep every existing field, including each thread's `image` and its credit. A new thread may go without an image.

## 4. Check and publish

```
npm run validate
```

Fix every problem it reports and run it again until it says OK. It also checks the spread of local stories and the share of conflict stories. Then save a copy of the day:

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
