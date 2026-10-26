# Pitch: Trusted Agent Hiring

Three minutes, two speakers. Person A tells the problem and the registry side; Person B drives the demo.
Numbers below come from our own devnet runs on 24 Oct 2026. Re-check them the morning of the event.

## Before you start

- [ ] `docker compose up` running, http://localhost:3000 open, browser zoomed to 125%
- [ ] One warm-up run done (fills the Wikipedia cache, so the live run is fast)
- [ ] Solana Explorer tab ready on the orchestrator wallet:
      https://explorer.solana.com/address/9cDFyUj1iq43WqNRwBYRAu59HhycGHFzVLLzbq6NbnP3?cluster=devnet
- [ ] Backup video of a full run on the laptop, in case the network fails

## Script

**0:00 to 0:30 · The problem (Person A)**

> Research agents work as teams: one finds sources, one checks facts, one writes. Today those teams are
> hardcoded. When the answer has a wrong claim, nobody knows which agent made it, and you can't swap in a
> better agent or replace one that dies.
>
> The Solana Agent Registry should fix that: a public list of agents anyone can hire. So we checked it.
> Of 4,829 agents on devnet, only 86 have an endpoint you can even call. Under 2%. You can't hire from
> an open registry blindly.

**0:30 to 0:50 · What we built (Person A)**

> We built a trust layer. Our orchestrator hires a fresh team from the registry for every question,
> and only hires agents that prove themselves. Every claim is traced to the agent that made it, and every
> agent's performance goes back on-chain, so the next hire is smarter.

**0:50 to 2:20 · Live demo (Person B)**

Type: *How was penicillin discovered and why did it matter?* Tick **Kill the main retriever**. Click **Run**.

> It searches the registry for agents with the skills each role needs.

Point at the **Hiring** table as it fills:

> Each candidate goes through three checks: reputation on-chain, is it alive, and a known-answer test
> graded by code. These two are our deliberately bad agents. One lies, one is too slow. After earlier runs
> their on-chain score is zero, so they are rejected before we even test them. These three are real
> third-party agents from the registry. Their endpoints are dead.

Point at the **Failovers** row:

> We just killed our main retriever mid-run. The backup took over in milliseconds and the run kept going.

Point at the **Claims** table:

> Every claim carries the exact quote, its source, the agent that made it, and a different agent that
> checked the quote is really on that page.

Click a feedback transaction link, show Solana Explorer:

> And every agent's score is written to the registry, signed by our orchestrator. Anyone can audit it.

**2:20 to 2:50 · Results (Person A)**

> Same five questions through a fixed team with one bad agent, and through our system. Unsupported claims in
> the final answer: 11% for the fixed team (4 of 38), zero for ours (0 of 48). 100% of claims tagged, 100% of bad agents
> rejected, failover in under 5 seconds.

**2:50 to 3:00 · Close (Person A)**

> Open registries make agents replaceable. We make them trustworthy. It's open source and works with any
> multi-agent system.

## Questions judges may ask

| Question | Answer |
|---|---|
| You registered your own agents. Is that a real open registry? | The registry is real and public. We also trial third-party agents in every run; all the ones with endpoints were dead, which is the problem we solve. Our agents exist because no third-party research agents with these skills exist yet. |
| Can't an agent pass the trial and then lie? | Yes, so the trial is only the first gate. Every claim is checked by a different agent against the source page, and the lie lowers its on-chain score. |
| Isn't your orchestrator the only reviewer? | Each feedback is signed by our orchestrator's wallet. Other users can choose which reviewers to trust; reputation is per reviewer by design. |
| Why not a database? | Reputation has to be shared across teams and impossible to edit quietly. That's what the chain gives. |
| Where's validation? | The SDK's validation functions are archived. We record each verifier verdict as feedback and link the full run report, so the reasoning is auditable. |
| Do you trial every agent on every question? | Trials are cheap and graded by code. Agents with a bad record skip straight to rejection, and the gate only applies after 3 ratings so one bad day is not a ban. |
| What does the LLM do? | It plans, picks claims, verifies meaning and writes the answer (Groq, gpt-oss-120b). With LLM=off the agents run on rules: the trust layer is identical; only the agents' brains differ. |
| Why is failover so fast? | The backup already passed its trial, so it's hired before anything fails. Switching is just calling the next agent. |

## Slides (5)

1. **Title.** Trusted Agent Hiring: hire AI agents from an open registry, safely.
2. **Problem.** Fixed teams can't be traced or repaired. Open registry: 86 of 4,829 agents callable.
3. **How it works.** The workflow diagram from our team doc: discover → reputation → alive → trial → run →
   cross-verify → failover → feedback.
4. **Results.** The KPI table from README.md.
5. **What's next.** Deploy agents publicly, more LLM providers, more third-party agents, reviewer trust weighting.
