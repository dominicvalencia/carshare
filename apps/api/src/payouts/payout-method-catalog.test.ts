import { describe, expect, it } from 'vitest';
import { ownerPayoutMethodCatalog, payoutMethodInstitution } from './payout-method-catalog';

describe('owner payout-method catalog', () => {
  it('projects the supported Philippine bank and wallet destinations safely', () => {
    const catalog = ownerPayoutMethodCatalog(['BANK_ACCOUNT', 'E_WALLET']);

    expect(catalog).toEqual({
      country: 'PH',
      currency: 'PHP',
      methods: [
        expect.objectContaining({ code: 'PH_BPI', displayName: 'BPI', type: 'BANK_ACCOUNT' }),
        expect.objectContaining({ code: 'PH_BDO', displayName: 'BDO', type: 'BANK_ACCOUNT' }),
        expect.objectContaining({
          code: 'PH_METROBANK',
          displayName: 'Metrobank',
          type: 'BANK_ACCOUNT',
        }),
        expect.objectContaining({ code: 'PH_GCASH', displayName: 'GCash', type: 'E_WALLET' }),
        expect.objectContaining({ code: 'PH_MAYA', displayName: 'Maya', type: 'E_WALLET' }),
      ],
    });
    expect(JSON.stringify(catalog)).not.toMatch(/secret|token|provider/i);
  });

  it('filters channels by provider-supported destination type', () => {
    expect(ownerPayoutMethodCatalog(['E_WALLET']).methods.map(({ code }) => code)).toEqual([
      'PH_GCASH',
      'PH_MAYA',
    ]);
  });

  it('provides a safe fallback label for an existing unknown channel', () => {
    expect(payoutMethodInstitution('PH_OTHER_BANK')).toEqual({
      code: 'PH_OTHER_BANK',
      displayName: 'OTHER BANK',
    });
  });
});
