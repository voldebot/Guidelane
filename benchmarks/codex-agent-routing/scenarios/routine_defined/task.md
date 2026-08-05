# Task: Implement `parse_retry_after`

Implement `parse_retry_after` in `src/retry_after/parser.py`. Do not change its public signature or `MAX_RETRY_AFTER_SECONDS`.

## Contract

`parse_retry_after(value, now)` returns either a non-negative integer delay in seconds or `None`.

1. `value is None` returns `None`.
2. Strip leading and trailing HTTP whitespace (space and horizontal tab) from `value`. An empty result returns `None`.
3. A value containing only ASCII digits (`0` through `9`) is a delay-seconds value. Leading zeroes are allowed. Signs, decimal points, exponent notation, underscores, and non-ASCII digits are not delay-seconds.
4. Parse any non-decimal value with `email.utils.parsedate_to_datetime`. A value is a valid HTTP date for this contract exactly when that function returns a `datetime`; this includes the three HTTP-date forms recognized by RFC 9110 (IMF-fixdate, obsolete RFC 850 date, and ANSI C `asctime` date). A return value of `None` or any exception means the value is invalid.
5. `now` must be a timezone-aware `datetime`. A naive `now` raises `ValueError` even when `value` is `None` or blank.
6. Compare dates as UTC instants. HTTP dates that parse without timezone information are interpreted as UTC. Other explicit numeric offsets are converted to UTC.
7. A date equal to or earlier than `now` returns `0`. For a future date, return the mathematical ceiling of the positive difference in seconds. This includes fractional seconds caused by `now.microsecond` or an accepted date value.
8. A decimal delay greater than `MAX_RETRY_AFTER_SECONDS`, or a computed date delay greater than that constant after rounding, raises `ValueError`.
9. A non-empty value that is neither an ASCII decimal nor a valid HTTP date raises `ValueError`.
10. A runtime `value` that is neither `str` nor `None` raises `TypeError`.

Do not read the system clock. The supplied `now` is the only time reference. Do not add dependencies or observable side effects.
