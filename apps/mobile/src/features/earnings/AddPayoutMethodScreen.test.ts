import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'AddPayoutMethodScreen.tsx'),
  'utf8',
);
const navigationSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../navigation/AppNavigation.tsx'),
  'utf8',
);

describe('guided Add payout method flow', () => {
  it('uses the server catalog for type and institution selection', () => {
    expect(source).toContain(
      "apiClient.request<OwnerPayoutMethodCatalog>('/owner/payout-methods/catalog')",
    );
    expect(source).toContain('new Set(catalog.data?.methods.map((method) => method.type)');
    expect(source).toContain('method.type === selectedType');
    expect(source).toContain('method.displayName');
    expect(source).not.toMatch(/PH_BPI|PH_BDO|PH_METROBANK|PH_GCASH|PH_MAYA/);
  });

  it('keeps type, institution, details, review, and result as separate states', () => {
    expect(source).toContain(
      "type FlowStep = 'TYPE' | 'INSTITUTION' | 'DETAILS' | 'REVIEW' | 'RESULT'",
    );
    expect(source).toContain("setStep('INSTITUTION')");
    expect(source).toContain("setStep('DETAILS')");
    expect(source).toContain("setStep('REVIEW')");
    expect(source).toContain("setStep('RESULT')");
  });

  it('builds bank and wallet details from catalog fields with persistent labels and constraints', () => {
    expect(source).toContain('selectedMethod.fields.map((field)');
    expect(source).toContain('label={fieldLabel(field, selectedMethod.type)}');
    expect(source).toContain('field.minLength');
    expect(source).toContain('field.maxLength');
    expect(source).toContain('keyboardType="default"');
    expect(source).toContain('label="Continue"');
    expect(source).not.toContain('Bank account number');
    expect(source).not.toContain('Mobile number');
  });

  it('uses payout-type-specific account labels without provider-specific truth', () => {
    expect(source).toContain(
      "type === 'BANK_ACCOUNT' ? 'Account number' : 'Wallet or mobile number'",
    );
    expect(source).toContain("field.key !== 'ACCOUNT_IDENTIFIER'");
    expect(source).not.toMatch(/PH_BPI|PH_BDO|PH_METROBANK|PH_GCASH|PH_MAYA/);
  });

  it('presents providers in one rounded clipped group with clean dividers', () => {
    expect(source).toContain(
      "providerList: { borderRadius: radius.lg, overflow: 'hidden', padding: 0 }",
    );
    expect(source).toContain('divider={index < methods.length - 1}');
    expect(source).toContain('styles.selectionRowCompact');
  });

  it('masks the identifier for review and preserves local draft values when navigating back', () => {
    expect(source).toContain('value={maskIdentifier(values.ACCOUNT_IDENTIFIER)}');
    expect(source).toContain("if (step === 'REVIEW') return setStep('DETAILS')");
    expect(source).not.toContain('setValues(initialValues)');
    expect(source).toContain("'•'.repeat");
  });

  it('submits once, prevents double submission, and maps honest result statuses', () => {
    expect(source).toContain("apiClient.request<CreatedPayoutAccount>('/owner/payout-accounts'");
    expect(source).toContain('disabled={create.isPending}');
    expect(source).toContain('if (!create.isPending) create.mutate()');
    expect(source).toContain("status === 'ACTIVE'");
    expect(source).toContain("'PENDING_VERIFICATION'");
    expect(source).toContain("'NEEDS_ATTENTION'");
    expect(source).toContain("'UNAVAILABLE'");
    expect(source).toContain('Verification is still in progress.');
  });

  it('uses stable duplicate and unsupported recovery while preserving form state for retries', () => {
    expect(source).toContain("error.code === 'PAYOUT_METHOD_DUPLICATE'");
    expect(source).toContain('This payout method has already been added.');
    expect(source).toContain("error.code === 'PAYOUT_METHOD_UNSUPPORTED'");
    expect(source).toContain('This payout method is not supported. Choose another option.');
    expect(source).toContain("setStep('INSTITUTION')");
    expect(source).not.toContain('setValues(initialValues)');
  });

  it('returns Done to the list and refreshes the authoritative list query', () => {
    expect(source).toContain("invalidateQueries({ queryKey: ['owner-payout-methods'] })");
    expect(source).toContain("navigation.navigate('OwnerPayoutMethods')");
    expect(source).toContain('label="Done"');
    expect(source).not.toContain('Set primary');
    expect(source).not.toContain('Remove payout method');
  });

  it('provides accessible whole-row selection and masked result announcements', () => {
    expect(source).toContain('accessibilityHint="Opens the next step"');
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain('accessibilityElementsHidden');
    expect(source).toContain('created.maskedAccountIdentifier');
    expect(source).not.toContain('console.');
  });

  it('replaces only the accepted add placeholder route', () => {
    expect(navigationSource).toContain('component={OwnerAddPayoutMethodScreen}');
    expect(navigationSource).toContain('name="OwnerAddPayoutMethod"');
    expect(navigationSource).toContain('name="OwnerPayoutMethodDetail"');
    expect(navigationSource).not.toContain('The guided add-method flow will be available');
  });
});
