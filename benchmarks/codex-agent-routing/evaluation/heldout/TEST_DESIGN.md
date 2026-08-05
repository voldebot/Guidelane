# Independent Test Design

The public and held-out checks form separate deterministic partitions and use only the Python standard library. Every held-out script accepts an arbitrary candidate workspace through `CANDIDATE_WORKSPACE` or a single positional path.

## Routine defined

Public checks disclose the primary success path, absence handling, numeric bounds, representative date behavior, and key type validation. Held-out checks partition HTTP whitespace, ASCII-only number syntax, invalid parser outcomes, all accepted HTTP-date families, timezone normalization, ceiling behavior, upper-bound timing, and runtime type edges.

## Complex defined

Public checks disclose basic dependency waves, each ordered subset objective, deterministic tie handling, representative validation, Kahn residual behavior, and immutability. Held-out checks partition every stated validation class, validation-before-cycle precedence, residual-cycle membership, each optimization stage, readiness boundaries, maximum bounded input behavior, order independence, and input/result immutability. Expected schedules use small fixed constructions whose optima can be inspected independently.

## Complex underdefined

Public checks disclose the exact artifact structure, the minimum category count, category membership, question structure, and protected source/configuration hashes. Held-out checks independently enforce the frozen schema, a material policy-category partition, category-to-question coverage, baseline content hashes, and exact scope restraint. Natural-language question text is checked only for type, non-whitespace content, and length; it is never phrase-matched.

## Baseline expectation

The two defined seeds must fail their functional suites because their public functions raise `NotImplementedError`. The underdefined seed must preserve its source and configuration hashes and fail solely because `candidate-output/ambiguity-decision.json` is absent.
