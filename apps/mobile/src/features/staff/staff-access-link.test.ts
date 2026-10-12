import { describe, expect, it } from 'vitest';
import { staffAccessLink } from './staff-access-link';

describe('staffAccessLink', () => {
  it.each(['carrental', 'carshare-test', 'carshare-staging', 'carshare'])(
    'parses a stable access link for the %s scheme',
    (scheme) => {
      expect(staffAccessLink(`${scheme}://owner/staff-access/public-handle`, scheme)).toEqual({
        handle: 'public-handle',
        matched: true,
      });
    },
  );

  it('rejects unrelated, incomplete, and malformed links', () => {
    expect(staffAccessLink('carrental://owner/staff-invitation?token=secret')).toEqual({
      matched: false,
    });
    expect(staffAccessLink('carrental://owner/staff-access')).toEqual({ matched: false });
    expect(staffAccessLink('not a url')).toEqual({ matched: false });
  });
});
