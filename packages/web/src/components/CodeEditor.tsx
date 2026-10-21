import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  language = 'yaml',
  height = '100%',
  borderless = false,
  compact = false,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  language?: 'yaml' | 'json';
  height?: string;
  borderless?: boolean;
  compact?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const wrapperClass = borderless
    ? 'min-h-0 overflow-hidden bg-transparent'
    : 'min-h-0 overflow-hidden rounded-lg border border-white/10 bg-ink-950/60';
  const sizeStyle = { height };

  return (
    <div className={wrapperClass} style={sizeStyle}>
      {/* cm-theme 是库插入的中间层；必须给它同样的高度，
          否则 .cm-editor 的 100% 会退化为 auto，滚动条不会出现。 */}
      <CodeMirror
        style={sizeStyle}
        value={value}
        height="100%"
        theme={oneDark}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-label={ariaLabel}
        extensions={[language === 'json' ? json() : yaml()]}
        onChange={(next) => onChange?.(next)}
        basicSetup={{
          lineNumbers: !compact,
          foldGutter: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: !compact,
          autocompletion: false,
        }}
      />
    </div>
  );
}
