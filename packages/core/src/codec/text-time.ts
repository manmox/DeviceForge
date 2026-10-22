/**
 * 通用文本协议时间格式化。
 *
 * 支持 YYYY / MM / DD / HH / mm / ss 六种 token，其余字符原样保留。
 * 使用 Intl 而不是手写 UTC 偏移，local 和 IANA 时区都能正确处理夏令时。
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    ...(timezone === 'local' ? {} : { timeZone: timezone }),
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

export function isValidTextTimezone(timezone: string): boolean {
  if (timezone === 'local') return true;
  try {
    formatterFor(timezone);
    return true;
  } catch {
    return false;
  }
}

export function formatTextTimestamp(
  now: number,
  timezone: string,
  format: string,
): string {
  const parts = formatterFor(timezone).formatToParts(new Date(now));
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  const replacements: Record<string, string> = {
    YYYY: values.year?.padStart(4, '0') ?? '',
    MM: values.month?.padStart(2, '0') ?? '',
    DD: values.day?.padStart(2, '0') ?? '',
    HH: values.hour?.padStart(2, '0') ?? '',
    mm: values.minute?.padStart(2, '0') ?? '',
    ss: values.second?.padStart(2, '0') ?? '',
  };

  if (Object.values(replacements).some((value) => value === '')) {
    throw new Error(`无法格式化时间戳（时区 ${timezone}）`);
  }

  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => replacements[token]!);
}
