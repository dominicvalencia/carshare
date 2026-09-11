import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/onboarding/GuidedOnboarding.tsx', 'utf8');

describe('shared guided onboarding pager', () => {
  it('supports bounded forward and reverse page navigation', () => {
    expect(source).toContain('Math.max(0, Math.min(pageCount - 1, requestedPage))');
    expect(source).toContain('settle(currentPage + 1)');
    expect(source).toContain('settle(currentPage - 1)');
    expect(source).toContain('currentPage === 0');
    expect(source).toContain('currentPage === pageCount - 1');
  });

  it('requires a dominant horizontal gesture to preserve vertical form scrolling', () => {
    expect(source).toContain('Math.abs(gesture.dx) > 8');
    expect(source).toContain('Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5');
  });

  it('provides accessible progress and an explicit Skip action', () => {
    expect(source).toContain('accessibilityLabel={`Onboarding page');
    expect(source).toContain('accessibilityHint="Swipe left for next or right for previous"');
    expect(source).toContain('label="Skip onboarding"');
  });
});
