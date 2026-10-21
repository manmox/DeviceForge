import { hexToBytes } from '../lib/format';

export function HexDump({ hex, maxBytes = 4096 }: { hex: string; maxBytes?: number }) {
  const bytes = hexToBytes(hex);

  if (bytes.length === 0) {
    return <div className="px-1 py-2 text-xs text-mist-500">（无数据）</div>;
  }

  const limit = Math.min(bytes.length, maxBytes);
  const rows: { offset: number; hexPart: string; ascii: string }[] = [];

  for (let offset = 0; offset < limit; offset += 16) {
    const slice = bytes.slice(offset, offset + 16);
    const hexPart = slice
      .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    const ascii = slice
      .map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'))
      .join('');
    rows.push({ offset, hexPart, ascii });
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max font-mono text-[11.5px] leading-5">
        {rows.map((row) => (
          <div key={row.offset} className="flex gap-3 whitespace-pre">
            <span className="shrink-0 text-mist-600">
              {row.offset.toString(16).padStart(4, '0').toUpperCase()}
            </span>
            <span className="shrink-0 text-mist-300">{row.hexPart.padEnd(48, ' ')}</span>
            <span className="text-mist-500">{row.ascii}</span>
          </div>
        ))}
        {bytes.length > limit && (
          <div className="mt-1.5 text-[10.5px] text-mist-600">
            仅显示前 {limit} 字节，共 {bytes.length} 字节
          </div>
        )}
      </div>
    </div>
  );
}
