import { describe, expect, it } from 'vitest';
import { resolvePersonaMode, shouldPresentOwnerFirstEntry } from './persona-mode';

describe('marketplace persona mode resolution', () => {
  it('restores a saved mode only when that capability remains valid', () => {
    expect(
      resolvePersonaMode({
        initialPersona: 'RENTER',
        ownerEnabled: true,
        renterEnabled: true,
        savedMode: 'owner',
      }),
    ).toBe('owner');
    expect(
      resolvePersonaMode({
        initialPersona: 'RENTER',
        ownerEnabled: false,
        renterEnabled: true,
        savedMode: 'owner',
      }),
    ).toBe('renter');
  });

  it('uses the initial persona when no saved mode is available', () => {
    expect(
      resolvePersonaMode({
        initialPersona: 'RENTER',
        ownerEnabled: true,
        renterEnabled: true,
        savedMode: null,
      }),
    ).toBe('renter');
    expect(
      resolvePersonaMode({
        initialPersona: 'OWNER',
        ownerEnabled: true,
        renterEnabled: true,
        savedMode: null,
      }),
    ).toBe('owner');
  });

  it('falls back deterministically without granting an unavailable capability', () => {
    expect(
      resolvePersonaMode({
        initialPersona: 'OWNER',
        ownerEnabled: false,
        renterEnabled: true,
        savedMode: null,
      }),
    ).toBe('renter');
    expect(
      resolvePersonaMode({
        initialPersona: null,
        ownerEnabled: true,
        renterEnabled: false,
        savedMode: null,
      }),
    ).toBe('owner');
    expect(
      resolvePersonaMode({
        initialPersona: null,
        ownerEnabled: false,
        renterEnabled: false,
        savedMode: null,
      }),
    ).toBeNull();
  });
});

describe('Owner first-entry presentation', () => {
  it('shows Owner Welcome for Owner-first registration and explicit second-persona intent', () => {
    expect(
      shouldPresentOwnerFirstEntry({
        firstEntryIntent: false,
        initialPersona: 'OWNER',
        mode: 'owner',
        ownerEnabled: true,
        ownerOnboardingFirstEnteredAt: null,
      }),
    ).toBe(true);
    expect(
      shouldPresentOwnerFirstEntry({
        firstEntryIntent: true,
        initialPersona: 'RENTER',
        mode: 'owner',
        ownerEnabled: true,
        ownerOnboardingFirstEnteredAt: null,
      }),
    ).toBe(true);
  });

  it('does not globally force Welcome for ordinary Hosting or after entry was recorded', () => {
    expect(
      shouldPresentOwnerFirstEntry({
        firstEntryIntent: false,
        initialPersona: 'RENTER',
        mode: 'owner',
        ownerEnabled: true,
        ownerOnboardingFirstEnteredAt: null,
      }),
    ).toBe(false);
    expect(
      shouldPresentOwnerFirstEntry({
        firstEntryIntent: true,
        initialPersona: 'RENTER',
        mode: 'owner',
        ownerEnabled: true,
        ownerOnboardingFirstEnteredAt: '2026-09-11T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('never shows Welcome in Renting mode or without OWNER authority', () => {
    expect(
      shouldPresentOwnerFirstEntry({
        firstEntryIntent: true,
        initialPersona: 'RENTER',
        mode: 'renter',
        ownerEnabled: true,
        ownerOnboardingFirstEnteredAt: null,
      }),
    ).toBe(false);
    expect(
      shouldPresentOwnerFirstEntry({
        firstEntryIntent: true,
        initialPersona: 'RENTER',
        mode: 'owner',
        ownerEnabled: false,
        ownerOnboardingFirstEnteredAt: null,
      }),
    ).toBe(false);
  });
});
