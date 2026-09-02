export function normalizeDateOnly(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
}

export function dateWithinBounds(value: Date, minimumDate?: Date, maximumDate?: Date) {
  const normalizedValue = normalizeDateOnly(value);
  const normalizedMinimum = minimumDate ? normalizeDateOnly(minimumDate) : undefined;
  const normalizedMaximum = maximumDate ? normalizeDateOnly(maximumDate) : undefined;

  if (normalizedMinimum && normalizedValue < normalizedMinimum) return normalizedMinimum;
  if (normalizedMaximum && normalizedValue > normalizedMaximum) return normalizedMaximum;
  return normalizedValue;
}
