# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: hackathon judges at VVCE Hack Day (27 Oct 2026), watching the results page on a projector or a
laptop while the two-person team drives a live demo of about three minutes. They must grasp the story at a
glance and from across a room.

Secondary: the two team members, who operate the page during the demo (type a question, start a run,
optionally kill an agent) and answer questions from it.

## Product Purpose

An orchestrator that hires a research team of AI agents from the Solana Agent Registry for each question
and trusts only agents that prove themselves: it screens candidates (on-chain reputation, liveness, a
known-answer trial graded by code), runs the hired team with cross-verification and failover, and writes
every agent's score back on-chain. Success: judges see bad and dead agents rejected, a killed agent
replaced, every claim traced to its source and agents, and the feedback transactions on Solana.

## Positioning

A trust layer for hiring from an open agent registry, demonstrated on research. It claims reliable runs and
traceable claims, not smarter answers. The mechanism a neighbor could not copy: screening against live
registry data, with the results written back so the next hire is better informed.

## Operating Context

Track 2, Challenge 01 (Best Use of the Solana Agent Registry). Runs locally (`docker compose up`,
http://localhost:3000) against Solana devnet and Wikipedia. Each run takes roughly 10 to 40 seconds; the
page polls for progress. Judging follows a live demo and a short Q&A.

## Capabilities and Constraints

- Next.js 15 + TypeScript + Tailwind CSS 4 page (`frontend/`), proxying `/api/*` to the FastAPI backend.
- Data per run: question, mode (rule-based or LLM), registry stats, plan, hiring table (stage reached,
  result, reason, on-chain score and rating count), claims (text, quote, source, producer, verifier,
  status), answer with `[cN]` citations, failovers with takeover time, feedback with Solana transaction
  signatures, metrics. Optional baseline comparison (`runs/compare.json`).
- Controls: question input, "kill the main retriever mid-run" checkbox, Run button; one run at a time.
- Currently runs in rule-based mode (no LLM credit).

## Brand Commitments

None. No logo, colors or fonts are fixed (confirmed 24 Oct 2026).

## Evidence on Hand

Real devnet results in `runs/` and README.md: 100% of claims tagged, 2 of 2 bad agents rejected, 0 of 3
third-party agents passed (dead endpoints), failover 32 ms warm / 3.1 s cold, 8 of 8 feedback transactions,
unsupported claims 11% (fixed team, 4 of 38) vs 0% (ours, 0 of 48) on 5 questions. Registry: 4,829 devnet agents, 86 with a
callable endpoint. No testimonials, users or partnerships exist; do not invent them.

## Product Principles

1. Prove, don't claim: every number on screen comes from a real run or the live registry.
2. Show the rejection as clearly as the success; the screening is the product.
3. Every claim stays traceable to its source and to the agents that produced and checked it.
4. Legible from across a room: the demo story reads in a glance, details on approach.
