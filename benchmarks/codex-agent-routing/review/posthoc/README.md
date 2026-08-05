# Routine-defined post-hoc diagnostic

This directory adds a narrow, non-scoring diagnostic for a contract edge identified in the blinded reviews but not covered by the frozen public or held-out suites.

Run it against any candidate snapshot without changing that snapshot:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 test_routine_contract_edges.py /path/to/candidate_snapshot
```

`CANDIDATE_WORKSPACE=/path/to/candidate_snapshot` is an equivalent input method. The test also sets `sys.dont_write_bytecode` before importing the candidate, so it does not create candidate-side bytecode files.

## Tested edge

| Edge | Required observable outcome | Reason |
| --- | --- | --- |
| A 5,000-character ASCII zero prefix followed by `42` | Return `42` | The contract permits leading zeroes, defines ASCII-only decimal syntax, and requires a decimal delay result. The frozen suites cover only short zero padding. |

The finite 5,000-character probe is deterministic and exceeds Python 3.11's usual decimal-string conversion limit, while remaining bounded. It detects implementations that convert the full padded string before removing leading zeroes.

## Unscored ambiguity

The contract says that `now` must be a timezone-aware `datetime`, and it explicitly requires `ValueError` for a naive `datetime`. It does not specify an exception class or another exact observable outcome when runtime `now` is not a `datetime`. A diagnostic that requires `TypeError`, `ValueError`, or an implicit attribute error would add a requirement, so no runtime-`now` type test is included.

This suite neither modifies snapshots nor evaluates, scores, or ranks candidates.
