export interface ReferenceAreaSelection {
  readonly code: string;
  readonly name: string;
  readonly kind?: string;
}

export function regionSelection(area: ReferenceAreaSelection) {
  return {
    addressScopeCode: '',
    barangay: '',
    barangayCode: '',
    cityMunicipality: '',
    cityMunicipalityCode: '',
    province: '',
    provinceCode: '',
    region: area.name,
    regionCode: area.code,
  };
}

export function scopeSelection(area: ReferenceAreaSelection) {
  return {
    addressScopeCode: area.code,
    barangay: '',
    barangayCode: '',
    cityMunicipality: '',
    cityMunicipalityCode: '',
    province: area.kind === 'PROVINCE' ? area.name : '',
    provinceCode: area.kind === 'PROVINCE' ? area.code : '',
  };
}

export function localitySelection(area: ReferenceAreaSelection) {
  return {
    barangay: '',
    barangayCode: '',
    cityMunicipality: area.name,
    cityMunicipalityCode: area.code,
  };
}

export function personalError(form: {
  readonly legalFirstName: string;
  readonly legalLastName: string;
  readonly dateOfBirth: string;
}) {
  if (!form.legalFirstName.trim() || !form.legalLastName.trim())
    return 'Enter your required legal names.';
  if (!form.dateOfBirth) return 'Select your date of birth.';
  if (form.dateOfBirth > canonicalToday()) return 'Date of birth cannot be in the future.';
  return '';
}

export function addressError(form: {
  readonly addressLine1: string;
  readonly regionCode: string;
  readonly addressScopeCode: string;
  readonly cityMunicipalityCode: string;
  readonly barangayCode: string;
  readonly postalCode: string;
}) {
  if (
    !form.addressLine1.trim() ||
    !form.regionCode ||
    !form.addressScopeCode ||
    !form.cityMunicipalityCode ||
    !form.barangayCode
  )
    return 'Complete every required residential address field.';
  if (!/^\d{4}$/.test(form.postalCode)) return 'Enter a four-digit postal code.';
  return '';
}

export function driverError(
  form: {
    readonly driverLicenseNumber: string;
    readonly driverLicenseExpiry: string;
    readonly driverLicenseClass: string;
  },
  hasExisting: boolean,
) {
  if (!hasExisting && !form.driverLicenseNumber.trim())
    return 'Enter your driver’s license number.';
  if (
    form.driverLicenseNumber &&
    !/^[A-Za-z0-9][A-Za-z0-9 -]{2,62}[A-Za-z0-9]$/.test(form.driverLicenseNumber.trim())
  )
    return 'Use only the letters, numbers, spaces, and hyphens shown on the license.';
  if (!form.driverLicenseClass.trim()) return 'Enter the classification shown on your license.';
  if (!form.driverLicenseExpiry || form.driverLicenseExpiry <= canonicalToday())
    return 'Select a future driver’s license expiration date.';
  return '';
}

export function emergencyError(
  form: {
    readonly emergencyContactName: string;
    readonly emergencyContactMobile: string;
    readonly emergencyContactRelation: string;
    readonly emergencyContactRelationOther: string;
  },
  renterMobile: string | null,
) {
  const any = Boolean(
    form.emergencyContactName.trim() ||
    form.emergencyContactMobile.trim() ||
    form.emergencyContactRelation,
  );
  if (!any) return '';
  if (
    !form.emergencyContactName.trim() ||
    !form.emergencyContactMobile.trim() ||
    !form.emergencyContactRelation
  )
    return 'Complete all emergency-contact fields, or leave all of them empty.';
  if (form.emergencyContactRelation === 'OTHER' && !form.emergencyContactRelationOther.trim())
    return 'Describe the emergency-contact relationship.';
  const contact = normalizeMobile(form.emergencyContactMobile);
  if (!contact) return 'Enter a valid Philippine mobile number.';
  if (contact === normalizeMobile(renterMobile ?? ''))
    return 'Emergency contact mobile number must be different from your number.';
  return '';
}

export function normalizeMobile(value: string) {
  const digits = value.replaceAll(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return '';
}

export function canonicalToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}
