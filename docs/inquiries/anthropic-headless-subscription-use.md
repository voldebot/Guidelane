# Draft inquiry — Anthropic: headless Claude Code use under a Max subscription

**Status**: DRAFT — not sent. Owner sends this; Guidelane's main thread does not
send mail on the owner's behalf.
**Why it exists**: REVIEW-01 finding #1 made a written answer an S0/S1 exit
criterion. We would rather be told "no" now than build three months on an
assumption.
**Send to**: Anthropic support (via the Claude Code / Console support channel,
so it lands with a ticket number we can cite).
**Track in**: `PROJECT_MAP.md` §6.

---

Subject: Is programmatic (headless) Claude Code use under a Max subscription acceptable?

Hello,

I am building an open-source, non-commercial, MIT-licensed tool called Guidelane.
It runs entirely on the user's own machine and has no server component of its
own. Before I go further I would like a written answer on one question, because
the whole design depends on it.

**What the tool does**

Guidelane spawns the official `claude` CLI as a subprocess — the real binary the
user installed, under the user's own login — and drives it with
`-p --input-format stream-json --output-format stream-json`. Around it, my own
code enforces a staged process: a fixed pipeline, machine-verified quality gates,
and a plain-language interface for people who cannot read code.

**What it deliberately does not do**

- It never reads, stores, copies, or transmits any credential or token. It reads
  `claude auth status --json` only to tell the user whether they are logged in.
- It does not use `--bare` or `--safe-mode`, and it does not set or inherit
  `CLAUDE_CODE_SIMPLE` or `CLAUDE_CODE_SAFE_MODE`.
- It does not rotate accounts, share one login between people, or resell access.
- It does not hammer the API on rate-limit errors: it reads `rate_limit_event`
  and sleeps until the reported `resetsAt` before resuming.
- It is not a hosted service and is not commercial. There is nothing to buy.

**The question**

Is this pattern — a local open-source tool spawning the official CLI
non-interactively, under the individual subscriber's own login, for that
subscriber's own work — acceptable use of a Max subscription?

I am specifically asking about the *unattended* case: the user starts a run in
the evening and the tool continues working through the night, pausing at rate
limits and resuming when the window resets. All of the work belongs to that one
subscriber; there is no multi-tenancy and no sharing.

**Why I am asking rather than assuming**

The Claude Code documentation describes headless mode and the SDK as supported
surfaces, but the consumer subscription terms are written around interactive
personal use. I can read that either way, and I do not want to build a tool that
quietly puts its users on the wrong side of your terms. If the answer is that
this belongs on API billing instead, I will say so plainly in the product and
add an API-key path — I would just rather learn that now than after other people
have installed it.

If it helps, I am happy to share the repository and the exact flags used.

Thank you,
