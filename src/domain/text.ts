// Retain legitimate Unicode (including joining marks), but reject ill-formed
// strings and directional overrides that can conceal labels/identifiers.
export function hasVisibleText(value: string): boolean {
  return Boolean(value.replace(/[\p{White_Space}\p{Cf}\p{Cc}]/gu, ""));
}
export function validText(value: string): boolean {
  return (
    !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(
      value,
    ) &&
    hasVisibleText(value) &&
    // eslint-disable-next-line no-control-regex -- Reject unsafe control characters in imported text.
    !/[\u202a-\u202e\u2066-\u2069\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(
      value,
    )
  );
}
export function validIdentifier(value: string): boolean {
  return (
    validText(value) && value.trim() === value && !/[\p{Cf}\p{Cc}]/u.test(value)
  );
}
export function validTimestamp(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, y, m, d, h, minute, s] = match;
  const year = Number(y),
    month = Number(m),
    day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    Number(h) < 24 &&
    Number(minute) < 60 &&
    Number(s) < 60
  );
}
