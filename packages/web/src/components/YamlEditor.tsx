import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';

export function YamlEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="h-full min-h-0 overflow-hidden rounded-lg border border-white/10 bg-ink-950/60">
      <CodeMirror
        value={value}
        height="100%"
        theme={oneDark}
        readOnly={readOnly}
        extensions={[yaml()]}
        onChange={(next) => onChange?.(next)}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          autocompletion: false,
        }}
      />
    </div>
  );
}
