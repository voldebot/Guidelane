# Third-Party Notices

## Current status: nothing third-party is vendored

As of 2026-07-31 this repository contains **no copied third-party source**. Every
file under `tools/` was written for this project. This file exists anyway,
because the obligation it records arrives *before* the first copy-paste, not
after — and a notices file created retroactively is a notices file with gaps.

## The rule

Guidelane's plan calls for taking MIT-licensed code and design ideas from other
projects. When any of that lands:

1. Add a section below naming **the project, its licence, the upstream URL, the
   commit or version taken from, and which files here contain it**.
2. Reproduce the upstream licence text in full — MIT requires the copyright
   notice and permission notice to travel with the code. A link is not
   compliance.
3. Mark the borrowed region in the source itself with a comment pointing back at
   the entry here. Six months later nobody remembers which function was ours.

Ideas, architecture, and approaches are not copyrightable and need no notice —
but they still get credit, in `README.md` under Credits. That is a courtesy the
project intends to honour regardless of what the licence compels.

## Expected donors (not yet used)

These are named in the plan as sources Guidelane intends to borrow from. They are
listed here so the eventual entries are easy to complete, **not** as a claim that
any of their code is present today.

| Project | Licence | Expected contribution |
|---|---|---|
| WrongStack | MIT | Cockpit UI derivation (SimpleUI), architecture patterns |
| taste-skill | MIT | Design-quality heuristics for the review lenses |

## Runtime dependencies

The probe suite has **zero npm dependencies** — Node 22 built-ins only.

The `claude` CLI is a separate, independently installed program that Guidelane
spawns as a subprocess under the user's own login. It is not vendored,
redistributed, or modified here, and its own licence and terms govern its use.
