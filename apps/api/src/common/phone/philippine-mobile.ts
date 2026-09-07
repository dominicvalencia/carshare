import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizePhilippineMobile(value: string): string {
  const phone = parsePhoneNumberFromString(value.trim(), 'PH');
  if (!phone?.isValid() || phone.country !== 'PH' || !/^\+639\d{9}$/.test(phone.number))
    throw new Error('INVALID_PHILIPPINE_MOBILE');
  return phone.number;
}
