const DISCOVERY_HOUR = 9;

export function discoveryDateForCalendarDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), DISCOVERY_HOUR, 0, 0, 0);
}

export function tripDateSummary(start: Date, end: Date) {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const currentYear = new Date().getFullYear();
  if (!sameYear) {
    return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  if (sameMonth) {
    const month = start.toLocaleDateString(undefined, { month: 'short' });
    const year = start.getFullYear() === currentYear ? '' : `, ${start.getFullYear()}`;
    return `${month} ${start.getDate()} – ${end.getDate()}${year}`;
  }
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const year = start.getFullYear() === currentYear ? '' : `, ${start.getFullYear()}`;
  return `${start.toLocaleDateString(undefined, options)} – ${end.toLocaleDateString(undefined, options)}${year}`;
}
