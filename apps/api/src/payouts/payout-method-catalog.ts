import type {
  OwnerPayoutMethodCatalog,
  OwnerPayoutMethodCatalogField,
  OwnerPayoutMethodCatalogItem,
  OwnerPayoutMethodType,
} from '@carrental/api-contracts';

const HOLDER_FIELD = {
  key: 'ACCOUNT_HOLDER_NAME',
  label: 'Account holder name',
  maxLength: 255,
  minLength: 2,
} as const satisfies OwnerPayoutMethodCatalogField;

const IDENTIFIER_FIELD = {
  key: 'ACCOUNT_IDENTIFIER',
  label: 'Account or wallet number',
  maxLength: 40,
  minLength: 6,
} as const satisfies OwnerPayoutMethodCatalogField;

const METHODS = [
  { code: 'PH_BPI', displayName: 'BPI', type: 'BANK_ACCOUNT' },
  { code: 'PH_BDO', displayName: 'BDO', type: 'BANK_ACCOUNT' },
  { code: 'PH_METROBANK', displayName: 'Metrobank', type: 'BANK_ACCOUNT' },
  { code: 'PH_GCASH', displayName: 'GCash', type: 'E_WALLET' },
  { code: 'PH_MAYA', displayName: 'Maya', type: 'E_WALLET' },
] as const satisfies readonly {
  readonly code: string;
  readonly displayName: string;
  readonly type: OwnerPayoutMethodType;
}[];

export function ownerPayoutMethodCatalog(
  supportedTypes: readonly OwnerPayoutMethodType[],
): OwnerPayoutMethodCatalog {
  return {
    country: 'PH',
    currency: 'PHP',
    methods: METHODS.filter(({ type }) => supportedTypes.includes(type)).map(
      ({ code, displayName, type }): OwnerPayoutMethodCatalogItem => ({
        code,
        displayName,
        fields: [HOLDER_FIELD, IDENTIFIER_FIELD],
        supportsPrimary: true,
        supportsRemoval: true,
        type,
      }),
    ),
  };
}

export function payoutMethodInstitution(code: string): { code: string; displayName: string } {
  const method = METHODS.find((item) => item.code === code);
  return {
    code,
    displayName: method?.displayName ?? code.replace(/^PH_/, '').replaceAll('_', ' '),
  };
}
