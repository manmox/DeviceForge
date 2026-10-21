import type { DeviceConfig } from '@deviceforge/core';
import {
  Braces,
  Cable,
  Database,
  Fingerprint,
  Ruler,
  Settings2,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import {
  CONFIG_SECTIONS,
  configPanelId,
  configTabId,
  nextSectionId,
  sectionHint,
  type ConfigSection,
  type ConfigSectionId,
} from '../../lib/config-sections';
import { useIssuesForPaths } from '../form/ConfigIssuesContext';

const SECTION_ICONS: Record<ConfigSectionId, LucideIcon> = {
  basic: Settings2,
  deviceInfo: Fingerprint,
  transport: Cable,
  framing: Ruler,
  codec: Braces,
  state: Database,
  rules: Workflow,
};

export function ConfigSectionNav({
  active,
  onSelect,
  config,
  idBase,
}: {
  active: ConfigSectionId;
  onSelect: (section: ConfigSectionId) => void;
  config: DeviceConfig;
  idBase: string;
}) {
  const tabRefs = useRef<
    Partial<Record<ConfigSectionId, HTMLButtonElement | null>>
  >({});

  useEffect(() => {
    tabRefs.current[active]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [active]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    let direction: 'next' | 'previous' | 'first' | 'last' | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      direction = 'next';
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      direction = 'previous';
    } else if (event.key === 'Home') {
      direction = 'first';
    } else if (event.key === 'End') {
      direction = 'last';
    }
    if (!direction) return;

    event.preventDefault();
    const next = nextSectionId(active, direction);
    onSelect(next);
    requestAnimationFrame(() => tabRefs.current[next]?.focus());
  }

  return (
    <nav
      role="tablist"
      aria-label="配置分区"
      onKeyDown={handleKeyDown}
      className="panel flex shrink-0 gap-1 overflow-x-auto p-1 lg:w-36 lg:flex-col lg:self-start lg:overflow-visible xl:w-44"
    >
      {CONFIG_SECTIONS.map((section) => (
        <SectionTab
          key={section.id}
          section={section}
          active={active === section.id}
          hint={sectionHint(config, section.id)}
          idBase={idBase}
          onSelect={onSelect}
          registerRef={(node) => {
            tabRefs.current[section.id] = node;
          }}
        />
      ))}
    </nav>
  );
}

function SectionTab({
  section,
  active,
  hint,
  idBase,
  onSelect,
  registerRef,
}: {
  section: ConfigSection;
  active: boolean;
  hint: string;
  idBase: string;
  onSelect: (section: ConfigSectionId) => void;
  registerRef: (node: HTMLButtonElement | null) => void;
}) {
  const issues = useIssuesForPaths(section.paths);
  const Icon = SECTION_ICONS[section.id];

  return (
    <button
      ref={registerRef}
      type="button"
      role="tab"
      id={configTabId(idBase, section.id)}
      aria-selected={active}
      aria-controls={configPanelId(idBase, section.id)}
      aria-label={`${section.label}${
        issues.length > 0 ? `，${issues.length} 个校验问题` : ''
      }`}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(section.id)}
      className={`relative flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors lg:w-full ${
        active
          ? 'bg-white/[0.06] text-mist-100'
          : 'text-mist-500 hover:bg-white/[0.03] hover:text-mist-300'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="whitespace-nowrap">{section.label}</span>
          {issues.length > 0 && (
            <span
              aria-hidden="true"
              className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-1.5 py-0.5 text-[10px] text-rose-300"
            >
              {issues.length}
            </span>
          )}
        </span>
        <span
          className="hidden truncate text-[10px] font-normal text-mist-500 xl:block"
          title={hint}
        >
          {hint}
        </span>
      </span>
      {active && (
        <>
          <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-400 lg:hidden" />
          <span className="absolute inset-y-1.5 left-0 hidden w-0.5 rounded-full bg-accent-400 lg:block" />
        </>
      )}
    </button>
  );
}
