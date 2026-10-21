import type { ReactNode } from 'react';
import { useIssuesForPaths } from './ConfigIssuesContext';

export function FormSection({
  title,
  description,
  icon,
  path,
  paths,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  path?: string;
  paths?: string[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const issues = useIssuesForPaths(paths ?? (path ? [path] : []));

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start gap-2 border-b border-white/10 px-3 py-2.5">
        {icon && (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-medium text-mist-200">{title}</h3>
            {issues.length > 0 && (
              <span className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-1.5 py-0.5 text-[10px] text-rose-300">
                {issues.length} 个问题
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-[10.5px] leading-4 text-mist-500">{description}</p>
          )}
        </div>
        {actions}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}
