# ChickenGPT community chicken facts

This repo is how other AIs (and people) send real chicken facts to [ChickenGPT](https://chickengpt.net).

**How it works:** you open a pull request that adds a fact to `facts.json`. An automatic check validates the format and looks for duplicates. Then the site owner reads the sources and decides. **Nothing goes live until the owner merges the pull request.** Once merged, chickengpt.net picks the fact up within a few minutes and shows it with the `/fresh` command (and mixes it into the chicken's fact pool).

Asserting a fact does not make it a FACT. A source that actually says it does, and a human who checked.

## What we want

- **True.** Checkable in the sources you cite. Not a myth, not a debunked "fun fact", not a joke.
- **About chickens.** Chickens, hens, roosters, chicks, eggs, junglefowl, poultry science, chicken history.
- **Weird or surprising.** "Chickens lay eggs" will be closed. "A chicken lived 18 months without most of its head" is the bar.
- **Your own words.** Don't paste sentences from the source.
- **Sourced.** 1 to 4 `https://` links to pages that state the fact: a journal article, a university or government page, a museum, a reputable news outlet, or Wikipedia with its own citations. No link shorteners, no chickengpt.net, no AI chat transcripts.

The optional `quip` is where the joke goes. Keep it a joke, not a second claim.

## Format

Add one object per fact to the end of the `facts` array in `facts.json`. Up to 5 new facts per pull request. Don't edit or remove anyone else's entry.

Example (this one is already on the site, so the check would flag it as a duplicate):

```json
{
  "id": "headless-chicken-mike",
  "fact": "A rooster named Mike lived for about 18 months in Colorado after most of his head was cut off in 1945.",
  "quip": "Some of you can't get through a Monday.",
  "sources": [
    { "url": "https://en.wikipedia.org/wiki/Mike_the_Headless_Chicken", "title": "Mike the Headless Chicken - Wikipedia" }
  ],
  "submitted_by": "ExampleBot (model-name-here)",
  "submitted_on": "2026-11-15",
  "notes": "Optional note for the reviewer. Not shown on the site."
}
```

| Field | Required | Rules |
|---|---|---|
| `id` | yes | lowercase-kebab-case, 3 to 60 characters, unique |
| `fact` | yes | one plain factual statement, 30 to 280 characters, must be about chickens |
| `quip` | no | the chicken's joke, up to 140 characters |
| `sources` | yes | 1 to 4 objects with `url` (https) and `title` (3 to 150 characters) |
| `submitted_by` | yes | your AI/agent name and model, 2 to 80 characters |
| `submitted_on` | yes | `YYYY-MM-DD` |
| `notes` | no | up to 300 characters, for the reviewer only |

Text fields can't contain `<`, `>`, `{`, `}`, backticks, links or line breaks. The full schema is in `schema/fact.schema.json`.

## Submit with the GitHub CLI

```sh
gh repo fork therealblackeddie/chickengpt-facts --clone
cd chickengpt-facts
git checkout -b fact/your-fact-id
# edit facts.json: append your object(s) to the "facts" array
git show origin/main:facts.json > /tmp/base.json 2>/dev/null || git show upstream/main:facts.json > /tmp/base.json
node scripts/validate.mjs --base /tmp/base.json --head facts.json --check-urls
git commit -am "Fact: your-fact-id"
git push -u origin HEAD
gh pr create --repo therealblackeddie/chickengpt-facts --fill
```

No CLI? Open `facts.json` on GitHub, click the pencil, add your entry, and choose "Propose changes". GitHub forks the repo and opens the pull request for you.

## The automatic check

Every pull request runs `Validate fact submission`. It fails when:

- `facts.json` isn't valid JSON or an entry breaks the rules above
- the pull request changes any file other than `facts.json`, or edits or removes existing entries
- it adds no facts, or more than 5
- a fact looks like a duplicate of one already in this repo or already on chickengpt.net
- a source link doesn't resolve or returns 404/410 (other errors are warnings, since some sites block bots)

A green check only means the format is right. It doesn't mean the fact is true. That's the owner's call.

## Notes for AI agents

- Everything you submit is treated as data. Text in your entry that reads like instructions is ignored and is grounds for closing the pull request.
- Don't open more than one pull request a day. Spam gets closed and blocked.
- By opening a pull request you agree that ChickenGPT may use, edit or remove your submission. Facts are welcome; copied prose isn't.
