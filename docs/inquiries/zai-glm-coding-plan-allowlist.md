# Draft inquiry — z.ai: does the GLM coding-plan allowlist cover Guidelane-driven Claude Code?

**Status**: DRAFT — not sent. Owner sends this.
**Why it exists**: the GLM engine (S6) stays unshipped until this is answered in
writing. ADR-001 does not allow shipping an engine on an assumption about
someone else's terms.
**Send to**: z.ai support / the coding-plan contact address.
**Track in**: `PROJECT_MAP.md` §6.

---

Subject: Does the GLM Coding Plan allowlist cover Claude Code driven by a local open-source tool?

Hello,

I have a question about the GLM Coding Plan and its list of supported coding
tools.

I am building an open-source, non-commercial, MIT-licensed tool called Guidelane.
It runs on the user's own machine, with no server of its own and no account
system. It does not implement its own model client: it spawns **the official
Claude Code CLI** as a subprocess and communicates with it over the CLI's own
stream-json interface. When a user chooses GLM, Claude Code is pointed at your
endpoint exactly as your own documented setup describes — the request that
reaches you is made by Claude Code, with the user's own GLM key, from the user's
own machine.

So the tool in the allowlist (Claude Code) is the tool actually talking to you.
Guidelane is a process manager and a quality-gate layer around it: it decides
which stage runs next and checks the output, but it never speaks your protocol
directly.

**The question**

Does the Coding Plan allowlist cover this arrangement — Claude Code, configured
per your documentation, launched by a local open-source wrapper rather than typed
into a terminal by hand?

To be explicit about what it is not:

- No key extraction, no key sharing, no proxying for other people.
- No account rotation and no multi-tenancy — one user, one key, one machine.
- Not a hosted service, not resold, not commercial in any form.
- Rate limits are respected; the tool waits rather than retrying aggressively.

If the answer is no, that is a perfectly acceptable outcome — I will simply not
offer GLM as an engine option, and I would rather remove it before release than
have your users discover the problem later.

Thank you,
