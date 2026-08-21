import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoundationPanel } from './FoundationPanel';

describe('FoundationPanel', () => {
  it('states that business modules have not started', () => {
    render(<FoundationPanel />);
    expect(screen.getByText('Business modules')).toBeTruthy();
    expect(screen.getByText('Intentionally not started')).toBeTruthy();
  });
});
