import { describe, expect, it } from 'vitest';
import {
  addressError,
  driverError,
  emergencyError,
  localitySelection,
  personalError,
  regionSelection,
  scopeSelection,
} from './renter-verification-form';

describe('renter verification form policy', () => {
  it('resets every incompatible descendant when region changes', () => {
    expect(
      regionSelection({ code: '1300000000', name: 'National Capital Region (NCR)' }),
    ).toMatchObject({
      addressScopeCode: '',
      barangayCode: '',
      cityMunicipalityCode: '',
      provinceCode: '',
      regionCode: '1300000000',
    });
  });

  it('resets city and barangay when province/scope changes', () => {
    expect(scopeSelection({ code: '1400100000', kind: 'PROVINCE', name: 'Abra' })).toEqual(
      expect.objectContaining({
        addressScopeCode: '1400100000',
        barangayCode: '',
        cityMunicipalityCode: '',
        provinceCode: '1400100000',
      }),
    );
  });

  it('resets barangay when city or municipality changes', () => {
    expect(localitySelection({ code: '1430100000', name: 'Bangued' })).toEqual({
      barangay: '',
      barangayCode: '',
      cityMunicipality: 'Bangued',
      cityMunicipalityCode: '1430100000',
    });
  });

  it('validates required identity, address, and driver fields', () => {
    expect(personalError({ dateOfBirth: '', legalFirstName: '', legalLastName: '' })).toMatch(
      /required legal names/i,
    );
    expect(
      addressError({
        addressLine1: '1 Street',
        addressScopeCode: '',
        barangayCode: '',
        cityMunicipalityCode: '',
        postalCode: '123',
        regionCode: '',
      }),
    ).toMatch(/required residential address/i);
    expect(
      driverError(
        { driverLicenseClass: '', driverLicenseExpiry: '', driverLicenseNumber: '' },
        false,
      ),
    ).toMatch(/license number/i);
  });

  it('rejects equivalent renter and emergency-contact PH mobile formats', () => {
    expect(
      emergencyError(
        {
          emergencyContactMobile: '09171234567',
          emergencyContactName: 'Separate Person',
          emergencyContactRelation: 'SIBLING',
          emergencyContactRelationOther: '',
        },
        '+639171234567',
      ),
    ).toMatch(/different from your number/i);
  });
});
