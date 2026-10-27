# Pitch: Sworn, a trust layer for the Solana Agent Registry

Track 2, Challenge A: Best Use of the Solana Agent Registry. Team Dancing Burgers. Demo: 27 Oct 2026.
Three minutes, two speakers: Person A tells the story, Person B drives the demo.

**The line to remember:** *The registry tells you who an agent is. Sworn tells you whether to trust it, and proves it on-chain.*

The registry is the product; the research agents are the workload we use to prove it. Lead with the registry every time.

All numbers below are from Solana devnet, read on 27 Oct 2026. The registry moves, so re-read them on the day
(the Registry trust tab and the landing page show them live).

---

## Where the project stands

### Built and working

| Area | What it does | Registry features used |
|---|---|---|
| **Discovery** | Finds candidates for each job in the 8004 registry (by OASF skill) and in SATI, including MCP-only agents | Indexer search, registration files, OASF skills |
| **Fake-reputation detector** | Reads every rating on the registry and flags the ones that don't look like independent customers: captive wallets, bursts, single sources, rings, self-ratings | `feedbacks` across the whole registry, rater wallets, agent owners |
| **Screening** | Independent reputation (flagged ratings and the operator's own wallets ignored) → alive check (MCP handshake for MCP servers) → standard benchmark | Reputation reads, liveness |
| **Standard benchmark** | The same test for every agent: 5 items per kind from SQuAD 2.0, HotpotQA and FEVER, five equal aspects, graded by code. 60/100 to be hired | Results written on-chain as ratings (`tag2 = sab-v1-n5`) |
| **The run** | LangGraph pipeline: plan → retrieve → read → reason → verify → generate. Every claim carries its quote, source and the agent that made it; a *different* agent checks it | – |
| **Failover** | Backups are hired up front; a dead agent is replaced mid-run (2 ms to 2.6 s in our kill-switch runs) | – |
| **Ratings back on-chain** | One rating per agent that worked: accuracy and honesty from its benchmark, reliability/speed/grounding averaged over benchmark and run | `giveFeedback` with `feedbackFileHash` |
| **Sealed evidence** | Each rating links an evidence file (calls, claims, verdicts). Its SHA-256 is part of the rating's on-chain SEAL hash, so the file can't be changed unnoticed. The **check** button recomputes the seal | SEAL v1 (`computeSealHash`) |
| **Guardrails** | Content policy (harmful and adult topics, instruction overrides) on questions and answers; no calls to private addresses (SSRF) for agents or sources; injected page sentences dropped; 256 KB reply cap; 40 on-chain writes per run | – |
| **Answer controls** | Length (short ~80 / medium ~200 / long ~450 words) and reasoning (light / standard / high) | – |
| **MCP server** | Sworn as tools for any MCP host (AI assistants, Cursor and other IDEs): `research_brief/standard/deep`, `get_evidence`, `get_hiring`, debug tools | – |
| **Web app** | Landing page (live registry numbers, fixed team vs Sworn) and the app: Answer, Plan, Sources, Evidence, Hiring, Registry trust (live graph), On-chain, Timing, Inspector, Benchmarks, History | – |

Stack: Next.js · FastAPI + LangGraph · Postgres · Redis · Node bridge on the 8004-solana SDK · Docker Compose ·
GitHub Actions (CI green) · Prometheus · Groq (gpt-oss-120b, with fallbacks) · Wikipedia + Tavily.

### The numbers

| What | Number |
|---|---|
| 8004 agents with an endpoint you can call | **90 of 4,844** (1.9%) |
| SATI agents listing an endpoint | 31 of 122, mostly template placeholders |
| Ratings on the 8004 registry | 5,049 on 1,825 agents, from 825 wallets |
| Ratings that don't look independent | **52.4%** flagged by at least one rule |
| Wallets that only ever rate one owner's agents | 207 wallets wrote **30.7%** of all ratings |
| Rated agents with no independent rating at all | 412 of 1,825 |
| Fixed team vs Sworn: unsupported claims in answers | **4 of 38 (11%) vs 0 of 48 (0%)**, same 5 questions |
| Claims checked across all runs | 421 verdicts, 404 supported, every one traced to its agent |
| On-chain ratings written by Sworn | 359 transactions on devnet |
| Failover (kill switch) | 2 ms to 2.6 s for the backup to take over |
| Outside registry agents hired | **0**. 7 tried in the latest run: 4 rejected on reputation, 2 MCP-only, 1 unreachable |
| Tests | 36 backend tests, CI green on both repos |

---

## Before you start

- [ ] `docker compose up` (includes the MCP server); http://localhost:3000 open, browser zoom 125%
- [ ] One warm-up run done (fills caches, and benchmarks today's agents so the live run is fast)
- [ ] Groq quota OK: if the warm-up says "provider limit", the fallback models take over, but runs get slower
- [ ] Tabs ready: landing page · the app · Registry trust tab · Solana Explorer on the reviewer wallet
      https://explorer.solana.com/address/9cDFyUj1iq43WqNRwBYRAu59HhycGHFzVLLzbq6NbnP3?cluster=devnet
- [ ] Backup video of a full run, in case the network or the AI provider fails
- [ ] Deck: `docs/Sworn - Track-2 VVCE.pptx` still shows older numbers and not the newest features; update it (see "To fix" below)

## Script (3 minutes)

**0:00 to 0:35 · The problem (Person A)**

> The Solana Agent Registry is a public phone book of AI agents anyone can hire. We read all of it.
> Of 4,844 agents, 90 have an address you can even call. And the reputation layer is worse than empty:
> about half of the 5,000 ratings on it don't look like independent customers. 207 wallets only ever rate one
> owner's agents, and they wrote almost a third of all ratings. A high score on the registry today tells you
> almost nothing.

**0:35 to 0:55 · What we built (Person A)**

> Sworn is a trust layer for the registry. It reads every rating, throws out the ones that look fake, tests each
> agent on public benchmarks before it works, checks every claim it makes, and writes an honest score back to the
> registry, sealed so nobody, including us, can change the evidence later.

**0:55 to 2:25 · Live demo (Person B)**

1. **Registry trust tab.** Show the graph: *"Red clusters are wallets that only rate one owner. Click one."* Click the big
   owner node: 400+ agents, hundreds of ratings from captive wallets. Pick the *captive wallet* chip to light up
   only those links.
2. **Ask a question.** *How was penicillin discovered and why did it matter?* Medium length, standard reasoning, tick
   **Kill main retriever mid-run**, Run.
3. **Hiring tab.** *"Every candidate: independent reputation, alive, then the same benchmark. These outside agents
   from the registry failed; this Fake-Quote Bot scored 40 and is out."*
4. **Timing / failover.** *"We killed the main retriever. The backup took over in about two seconds."*
5. **Answer.** Click a citation: the exact sentence, the page, the agent that found it, and a different agent that checked it.
6. **On-chain tab.** *"Each agent gets its own rating, made of accuracy and honesty from the benchmark and reliability,
   speed and grounding from this run."* Click **check**: *"My browser hashed the evidence file, and the registry's
   seal recomputes exactly: this is the file the rating was written with."* Open one transaction in Explorer.

**2:25 to 2:50 · Results (Person A)**

> Same five questions, a fixed team with one bad agent against Sworn: 11% of the fixed team's claims weren't backed
> by their source; Sworn's were all backed. Every claim is traced to its agent, every bad agent was rejected, and a
> dead agent is replaced in seconds.

**2:50 to 3:00 · Close (Person A)**

> Open registries make agents easy to find. Sworn makes them safe to hire, and makes the registry's reputation mean
> something again. It also runs as an MCP tool, so AI assistants and IDEs like Cursor can hire through it.

---

## Pluses: lead with these

- **Deep, registry-first use.** Identity, discovery by OASF skill, reputation reads, liveness and on-chain writes,
  plus a registry-wide reputation audit. Most entries will only list or register agents.
- **A real finding about the registry**, measured from its own data: about half its ratings look non-independent.
  It's concrete, surprising and checkable.
- **Verifiable, not just "on-chain".** Evidence hashes sit inside the rating's SEAL hash; the check button proves the
  file and the rating match. Few teams will have touched SEAL.
- **Fair, public scoring.** One code-graded benchmark built from SQuAD 2.0, HotpotQA and FEVER, the same for every
  agent, ours included; self-ratings never count.
- **Honest scores.** Run ratings include benchmark accuracy and honesty, so a fast but wrong agent can't score 100.
  The Claim Builder dropped to 92 when its honesty on unanswerable questions showed.
- **Resilience you can watch.** The kill switch and the failover record make it tangible.
- **Production habits.** Guardrails (content policy, SSRF, prompt injection, caps), 36 tests, CI, Prometheus
  metrics, Docker, MCP server.
- **Measured improvement:** 11% → 0% unsupported claims against a fixed team.

## Minuses: know them, own them

| Weakness | Why it matters | What to say |
|---|---|---|
| **No outside agent has been hired.** All outside candidates failed (dead, MCP-only or bad reputation) | Judges may ask "is this really an open market?" | "That *is* the finding: the registry has almost no hireable research agents today. Sworn is built so the first good one gets hired automatically, with no code change." |
| **Our own ratings look like self-ratings.** Our reviewer wallet rates our owner wallet's agents; our own detector flags that as captive / single-source | It looks hypocritical if a judge spots it | Say it first: "Our detector caught us too. That's why screening ignores our own wallets' ratings of our agents." |
| **Evidence links point to `localhost:3001`** | A judge opening a link from Explorer gets nothing; the files only exist on our machine | "The hash is on-chain, so the files can be hosted anywhere (IPFS, a server) and still verify. For the demo they're served locally." Fix if time: host them publicly |
| **The backup agents are copies.** Five of Ritesh's six new agents run exactly the same code as the originals | Calling them independent agents would be wrong | Call them backups for failover, not independent agents |
| **Ritesh's 6 agents are registered from his wallet (`FxS7…`)** but run on our server | They could be mistaken for third-party hires | Present them as our team's agents, registered from a second team wallet |
| **Small benchmark and small comparison.** 5 items per kind; the 11% → 0% result is 5 questions and 86 claims | Not statistically strong | "Enough to separate good from broken agents, not to rank two good ones. More items and questions are a config change." |
| **Benchmark items are public** | An agent could be trained on them | A rotating hidden set is the fix; mentioned in docs/BENCHMARK.md |
| **Outside agents can get locked out.** The 4 agents rejected on reputation got their bad reputation mostly from our own 0 ratings when they were down, and are never contacted again | Unfair to an agent that was down for an afternoon | Planned fix: retry after a cooling-off period, or count only recent ratings |
| **Detector rules are heuristics.** A real customer of one product looks "captive"; a swarm of one-time wallets (the top agent: 235 ratings from 235 wallets, all 100) isn't caught | Overclaiming would be attackable | "A flag only removes a rating from the score; it's never a verdict on the agent." Name the swarm gap as next work |
| **The validation registry is archived** in the 8004 SDK | We can't write validations on-chain | Verifier verdicts live in Postgres and are sealed into each rating's evidence file |
| **Devnet only; free-tier AI** | Groq limits can slow or stop runs; the indexer rate-limits at 60/min | Fallback models and cached data keep runs going; mention production would use paid tiers and a private RPC |
| **No authentication** on the API, admin and kill endpoints | Fine on localhost, unsafe if hosted | Say it's a localhost demo; a token is the first step before hosting |
| **SATI ratings are off; MCP-only agents can't be hired** | Two registries' agents are found but can't be fully used | "Found and checked; hiring them needs SATI writes on and an MCP task adapter." |
| **Some old on-chain ratings link to run pages we deleted** | A curious judge could find a dead link | Rare; avoid opening old transactions |

## Don't say

- "We hired agents from the registry" (we hired our own; every outside candidate failed).
- "Ritesh's agents are third-party" or "we have 12 independent agents".
- "Anyone can open the evidence link" (it's localhost; the *hash* is what's public).
- "We use the validation registry" (it's archived; we explain how we replaced it).
- "Statistically significant" about 11% → 0%.

## Questions judges may ask

| Question | Answer |
|---|---|
| Why is this the best use of the registry? | We use it end to end: discovery by skill, liveness, reputation reads across the whole registry, and sealed ratings written back. And we found and fixed a real weakness in its reputation. |
| How do you know ratings are fake? | We don't claim they're fake; we flag patterns any reviewer can check: wallets that only ever rate one owner, bursts seconds apart, one wallet behind all of an agent's ratings, rings. Flags only remove ratings from the score. |
| Isn't Sworn just another rater people must trust? | Every Sworn rating carries a sealed evidence file. You can recompute the hash and check the claims, quotes and verdicts yourself; you don't have to trust us. |
| You rate your own agents. | Yes, and our detector flags it. Screening ignores the operator's own wallets, so our agents get no advantage. |
| Can an agent pass the benchmark and then lie? | The benchmark is only the first gate. Every claim is checked by a different agent against the source, and the run rating includes grounding, so a lie costs it on-chain. |
| Why 5 aspects with equal weights? | It avoids hand-tuning in our favour. Accuracy and honesty need known answers, so they come from the benchmark; the rest is measured in the run too. |
| Why not a database? | Reputation has to be shared across teams and impossible to edit quietly. That's what the chain gives; the seal makes the evidence tamper-evident too. |
| What stops prompt injection or malicious agents? | Guardrails: page sentences that try to instruct the model are dropped, agents and sources can't reach private addresses, replies are size-capped, and on-chain writes per run are capped. |
| Why is failover so fast? | Backups pass screening up front, so switching is just calling the next agent. |
| What does the LLM do? | Plans, picks claims, checks meaning and writes (Groq, gpt-oss-120b, with fallback models). The trust layer itself is code: discovery, screening, grading, sealing. |
| What's next? | Public evidence hosting, a retry window for locked-out agents, a swarm-detection rule, a hidden rotating benchmark, SATI writes, an MCP task adapter. |

## To fix before or after the demo

1. **Deck:** update `docs/Sworn - Track-2 VVCE.pptx` with the registry trust finding (52% flagged, 207 captive wallets),
   90 of 4,844, sealed evidence and guardrails. It predates them.
2. **Evidence hosting:** serve evidence files from a public URL (or IPFS) so on-chain links work for anyone.
3. **Reputation retry:** let agents rejected on reputation be re-tested after a cooling-off period.
4. **Swarm rule:** flag many first-time wallets rating one agent in a short window.
5. **Auth:** a token on `/api/run` and the admin endpoints before hosting anywhere.
