import { timingSafeEqual } from 'node:crypto';

export function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || /CHANGE_ME|PLACEHOLDER/i.test(secret)) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
