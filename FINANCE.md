# FinancePal — Personal Finance AI Assistant

This repository is a fork of [OpenClaw](https://github.com/openclaw/openclaw), customized into **FinancePal**: a proactive, personal finance AI assistant that lives on your devices and runs on your own data.

## What We're Building

FinancePal takes the OpenClaw personal AI assistant framework and specializes it around three core capabilities:

### 1. Credit Card Optimization

- Analyze your spending patterns to surface the highest-reward card for each purchase category (dining, travel, groceries, gas, etc.)
- Track sign-up bonus progress and alert you when you're close to hitting a spend threshold
- Recommend card combinations to maximize total annual return
- Flag cards that are no longer earning their annual fee

### 2. Financial Profile Building

- Maintain a living, structured profile of your income, accounts, liabilities, recurring bills, and net worth
- Ingest statements, receipts, and transaction exports to keep the profile current
- Identify trends across months and years — spending drift, savings rate changes, debt payoff pace
- Store everything locally (your data never leaves your machine unless you explicitly choose)

### 3. Proactive Money Coaching

- Deliver unprompted nudges when something warrants attention: a bill due tomorrow, a card's grace period ending, an unusual charge, a budget category going over
- Answer questions in plain English: "How much did I spend on food last month?" or "Which card should I use for this hotel?"
- Generate monthly and annual summaries automatically
- Set and track financial goals with milestone check-ins

## Architecture

FinancePal is built on top of OpenClaw's Gateway — the local-first control plane that handles sessions, channels, tools, and skills. The finance layer is implemented as OpenClaw skills and tools that extend the base assistant with domain-specific knowledge and data pipelines.

## Upstream

This fork tracks [openclaw/openclaw](https://github.com/openclaw/openclaw). The `upstream` remote is configured so we can pull in future OpenClaw improvements without losing our customizations.

```bash
git fetch upstream
git merge upstream/main
```

## Status

> Work in progress. See `soul.md` for the assistant's identity and values once defined.
