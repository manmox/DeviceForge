import type { DeviceConfig } from '@deviceforge/core';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  transportEndpoint,
  transportPresentation,
} from '../lib/transport-presentation';
import type { ValidationIssue } from '../types';

export function ValidationIssues({
  issues,
  className = 'max-h-32',
}: {
  issues: ValidationIssue[];
  className?: string;
}) {
  if (issues.length === 0) return null;
  return (
    <div
      className={`shrink-0 overflow-y-auto rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2 ${className}`}
    >
      <ul className="space-y-1 text-xs leading-5 text-rose-200">
        {issues.map((issue, index) => (
          <li key={`${issue.path}-${index}`}>
            <span className="font-mono text-rose-300">{issue.path || '(root)'}</span>：
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ValidationSummary({
  config,
  extra,
}: {
  config: DeviceConfig;
  extra?: ReactNode;
}) {
  const presentation = transportPresentation(config.transport.type);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-accent-500/20 bg-accent-500/[0.05] px-3 py-2 text-[11px] text-accent-200">
      <span className="inline-flex items-center gap-1">
        <Check className="h-3.5 w-3.5" />
        校验通过
      </span>
      <span className="font-mono">id: {config.id}</span>
      <span className="font-mono">
        {presentation.endpointShortLabel}: {transportEndpoint(config.transport)}
      </span>
      <span>{config.rules.length} 条规则</span>
      {extra}
    </div>
  );
}
