import {
  createContext,
  useContext,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

interface TabsContextValue {
  baseId: string;
  value: string;
  select: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tab, TabList and TabPanel must be used inside <Tabs>');
  return ctx;
}

const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');
const tabId = (baseId: string, value: string) => `${baseId}-tab-${safe(value)}`;
const panelId = (baseId: string, value: string) => `${baseId}-panel-${safe(value)}`;

export type TabsProps = {
  children: ReactNode;
  className?: string;
} & (
  | {
      /** Controlled (e.g. URL-driven: pass the route param and navigate in onValueChange). */
      value: string;
      onValueChange: (value: string) => void;
      defaultValue?: never;
    }
  | { value?: never; onValueChange?: (value: string) => void; defaultValue: string }
);

export function Tabs({ children, className, value, onValueChange, defaultValue }: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? '');
  const current = value ?? internal;

  const select = (next: string) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  return (
    <TabsContext.Provider value={{ baseId, value: current, select }}>
      <div className={cn('flex flex-col gap-20', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  /** Accessible name of the tab list (translated). */
  'aria-label': string;
  children: ReactNode;
  className?: string;
}

/** Pill tabs with roving focus: ←/→ (wrapping), Home and End move focus and select. */
export function TabList({ children, className, ...props }: TabListProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
    );
    const index = tabs.findIndex((tab) => tab === document.activeElement);
    if (index === -1) return;
    const target = {
      ArrowRight: tabs[(index + 1) % tabs.length],
      ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length],
      Home: tabs[0],
      End: tabs[tabs.length - 1],
    }[event.key];
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.click(); // automatic activation
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      // Horizontal scroll on narrow screens; padding keeps the focus ring unclipped.
      className={cn('-m-6 flex gap-8 overflow-x-auto p-6', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TabProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Tab({ value, children, disabled = false, className }: TabProps) {
  const { baseId, value: current, select } = useTabs();
  const selected = current === value;
  return (
    <button
      type="button"
      role="tab"
      id={tabId(baseId, value)}
      aria-selected={selected}
      aria-controls={panelId(baseId, value)}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => {
        select(value);
      }}
      className={cn(
        'inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full-2 border border-ink-black px-19 py-6 text-sm whitespace-nowrap transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected ? 'bg-ink-black text-pure-white' : 'text-ink-black hover:bg-pure-white',
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

/** Only the selected panel is rendered. */
export function TabPanel({ value, children, className }: TabPanelProps) {
  const { baseId, value: current } = useTabs();
  if (current !== value) return null;
  return (
    <div
      role="tabpanel"
      id={panelId(baseId, value)}
      aria-labelledby={tabId(baseId, value)}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}
