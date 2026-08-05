# Blinded Sol Review

This directory contains the exact evidence packet and prompt used for independent GPT-5.6 Sol Medium, High, XHigh, and Max reviews.

- `identity-map.json` joins anonymous candidate IDs to measured model configurations only after reviews finish.
- `generate_packet.py` mechanically builds `REVIEW_PACKET.md` from the immutable primary scores and retained candidate snapshots.
- `reviewer_prompt.txt` is the exact common instruction for every reviewer.
- `run_sol_reviewers.py` executes four isolated reviewers with the same packet and prompt, changing only reasoning effort.
- Reviewer workspaces receive only `REVIEW_PACKET.md`; they cannot read the identity map or primary repository.

The original deterministic scores remain immutable. Reviewer sensitivity corrections are reported separately.
