# Routine Contract Edge Results

## Status

The post-hoc diagnostic received an independent contract-review `GO` before execution. The test author and reviewer were distinct from every benchmark candidate and from each other.

This is sensitivity evidence, not a rewrite of the immutable primary scores. It was added after the blinded Sol reviews identified a contract-supported gap in the frozen suites.

## Result

The diagnostic passed a 5,002-digit ASCII decimal (`5,000` leading zeroes followed by `42`) to each retained routine snapshot. The contract permits leading zeroes and requires the result `42`.

| Candidate | Result |
| --- | --- |
| Luna High | Fail |
| Luna XHigh | Pass |
| Luna Max | Pass |
| Terra Low | Fail |
| Terra Medium | Pass |
| Terra High | Pass |
| Terra XHigh | Fail |
| Terra Max | Pass |
| Terra Ultra | Fail |

Every failure converted the full padded value with `int(value)` and raised Python's integer-string conversion-limit `ValueError` before applying the contract's leading-zero semantics. Passing implementations stripped insignificant zeroes or bounded the decimal lexically before conversion.

The runtime type of `now` remains unscored because the task does not define an exact exception class for a non-`datetime` value.
