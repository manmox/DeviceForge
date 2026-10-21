import { createContext, useContext, type ReactNode } from 'react';
import type { ValidationIssue } from '../../types';

const ConfigIssuesContext = createContext<ValidationIssue[]>([]);

export function ConfigIssuesProvider({
  issues,
  children,
}: {
  issues: ValidationIssue[];
  children: ReactNode;
}) {
  return (
    <ConfigIssuesContext.Provider value={issues}>{children}</ConfigIssuesContext.Provider>
  );
}

export function useIssues(path: string): ValidationIssue[] {
  return useIssuesForPaths([path]);
}

export function useIssuesForPaths(paths: string[]): ValidationIssue[] {
  const issues = useContext(ConfigIssuesContext);
  if (paths.length === 0) return [];
  return issues.filter((issue) =>
    paths.some(
      (path) => issue.path === path || issue.path.startsWith(`${path}.`),
    ),
  );
}

export function useIssueText(path: string): string | undefined {
  const issues = useIssues(path);
  return issues.length > 0 ? issues.map((issue) => issue.message).join('；') : undefined;
}
