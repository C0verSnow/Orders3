import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const ReducedMotion = createContext(false);
export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'),
      update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);
  return <ReducedMotion value={reduced}>{children}</ReducedMotion>;
}
const easing = 'cubic-bezier(0.22,0.61,0.36,1)';

// Render exact latest values immediately; only the decorative outgoing layer holds old text.
export function AnimatedValue({ value, text = false }: { value: string; text?: boolean }) {
  const reduced = useContext(ReducedMotion),
    incoming = useRef<HTMLSpanElement>(null),
    outgoing = useRef<HTMLSpanElement>(null),
    active = useRef(false);
  const [frame, setFrame] = useState({ value, previous: value, revision: 0, width: value.length });
  if (frame.value !== value)
    setFrame({
      value,
      previous: active.current ? frame.previous : frame.value,
      revision: frame.revision + 1,
      width: Math.max(frame.width, value.length),
    });
  const interrupted = useRef<{ enter: { opacity: string; transform: string }; exit: { opacity: string; transform: string } } | null>(null);
  useLayoutEffect(() => {
    if (!frame.revision || reduced) { interrupted.current = null; active.current = false; return; }
    active.current = true;
    const options = { duration: text ? 550 : 850, easing, fill: 'both' as const };
    const enter = incoming.current?.animate(
      [
        interrupted.current?.enter ?? { opacity: 0, transform: text ? 'none' : 'translateY(65%)' },
        { opacity: 1, transform: 'none' },
      ],
      options,
    );
    const exit = outgoing.current?.animate(
      [
        interrupted.current?.exit ?? { opacity: 1, transform: 'none' },
        { opacity: 0, transform: text ? 'none' : 'translateY(-65%)' },
      ],
      options,
    );
    interrupted.current = null;
    if (enter) enter.onfinish = () => { interrupted.current = null; active.current = false; };
    return () => {
      if (enter?.playState === 'running' && incoming.current) {
        const current = getComputedStyle(incoming.current), previous = getComputedStyle(outgoing.current!);
        interrupted.current = { enter: { opacity: current.opacity, transform: current.transform }, exit: { opacity: previous.opacity, transform: previous.transform } };
      }
      enter?.cancel();
      exit?.cancel();
    };
  }, [frame.revision, reduced, text]);
  return (
    <span
      data-ui="animated-value"
      className="inline-grid overflow-hidden align-bottom leading-tight tabular-nums"
      style={text ? undefined : { minWidth: `${frame.width}ch` }}
    >
      {frame.revision > 0 && (
        <span
          ref={outgoing}
          data-ui="value-out"
          className="pointer-events-none col-start-1 row-start-1 whitespace-nowrap opacity-0 motion-reduce:hidden"
          aria-hidden="true"
        >
          {frame.previous}
        </span>
      )}
      <span
        ref={incoming}
        data-ui={frame.revision ? 'value-in' : 'value'}
        className="col-start-1 row-start-1 whitespace-nowrap"
      >
        {value}
      </span>
    </span>
  );
}

export function TwoToneTitle({
  title,
  description,
  level = 2,
}: {
  title: string;
  description: string;
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  const typography =
    level === 1
      ? 'text-[26px] font-semibold leading-tight tracking-[-.045em] lg:text-[30px]'
      : 'text-sm font-semibold leading-normal tracking-tight md:text-[15px]';
  return (
    <div
      data-ui="two-tone-title"
      className={`flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 ${typography}`}
    >
      <Heading className="shrink-0 text-[#1d1d1f] dark:text-zinc-100">{title}</Heading>
      <p className="text-[#86868b] dark:text-zinc-400 [overflow-wrap:anywhere]">{description}</p>
    </div>
  );
}

export function FadeIn({
  children,
  className = '',
  role,
}: {
  children: ReactNode;
  className?: string;
  role?: 'status';
}) {
  const reduced = useContext(ReducedMotion),
    element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (reduced) return;
    const animation = element.current?.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 280, easing },
    );
    return () => animation?.cancel();
  }, [reduced]);
  return (
    <div ref={element} className={className} role={role}>
      {children}
    </div>
  );
}

type MotionItem = { id: string; version: string; content: ReactNode };
export function MotionList({
  items,
  as = 'tbody',
  className = '',
}: {
  items: MotionItem[];
  as?: 'tbody' | 'ol' | 'ul';
  className?: string;
}) {
  const [snapshot, setSnapshot] = useState({ items, exiting: [] as (MotionItem & { expires: number; index: number })[] });
  if (snapshot.items !== items) {
    const ids = new Set(items.map((item) => item.id));
    setSnapshot({
      items,
      exiting: [...snapshot.exiting, ...snapshot.items.map((item, index) => ({ ...item, expires: Date.now() + 750, index })).filter(item => !ids.has(item.id))].filter((item, index, all) => !ids.has(item.id) && all.findIndex(other => other.id === item.id) === index).slice(0, 40),
    });
  }
  useEffect(() => {
    if (!snapshot.exiting.length) return;
    const timer = setTimeout(() => setSnapshot((current) => ({ ...current, exiting: current.exiting.filter(item => item.expires > Date.now()) })), Math.max(0, Math.min(...snapshot.exiting.map(item => item.expires)) - Date.now()));
    return () => clearTimeout(timer);
  }, [snapshot.exiting]);
  const Tag = as,
    Item = as === 'tbody' ? 'tr' : 'li';
  const display = items.map(item => ({ item, exiting: false }));
  for (const item of [...snapshot.exiting].sort((a, b) => a.index - b.index)) {
    display.splice(Math.min(item.index, display.length), 0, { item, exiting: true });
  }
  return (
    <Tag className={className}>
      {display.map(({ item, exiting }, index) => (
        <MotionItemView key={item.id} item={item} as={Item} index={index} exiting={exiting} />
      ))}
    </Tag>
  );
}

function MotionItemView({
  item,
  as: Tag,
  index = 0,
  exiting = false,
}: {
  item: MotionItem;
  as: 'tr' | 'li';
  index?: number;
  exiting?: boolean;
}) {
  const reduced = useContext(ReducedMotion),
    element = useRef<HTMLTableRowElement & HTMLLIElement>(null),
    mounted = useRef(false),
    initialIndex = useRef(index);
  useLayoutEffect(() => {
    const initial = !mounted.current;
    mounted.current = true;
    if (reduced) return;
    const frames = exiting
      ? [{ opacity: 1 }, { opacity: 0 }]
      : initial
        ? [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'none' },
          ]
        : [{ opacity: 0.55 }, { opacity: 1 }];
    const animation = element.current?.animate(frames, {
      duration: initial || exiting ? 750 : 280,
      delay: initial && !exiting ? Math.min(initialIndex.current, 5) * 90 : 0,
      easing: 'ease-out',
      fill: 'backwards',
    });
    return () => animation?.cancel();
  }, [item.version, reduced, exiting]);
  return (
    <Tag
      ref={element}
      data-ui={exiting ? 'row-exit' : 'row'}
      className={exiting ? 'pointer-events-none opacity-0 motion-reduce:hidden' : ''}
      aria-hidden={exiting || undefined}
      inert={exiting || undefined}
    >
      {item.content}
    </Tag>
  );
}

export function ScrollFade({
  children,
  label,
  table = false,
  compact = false,
}: {
  children: ReactNode;
  label: string;
  table?: boolean;
  compact?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null),
    [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const element = viewport.current!,
      body = content.current!;
    let frame = 0;
    const update = () => {
      const remaining = element.scrollHeight - element.clientHeight - element.scrollTop;
      const more = remaining > 2;
      setMore(more);
      const bottom = element.getBoundingClientRect().bottom;
      for (const row of body.querySelectorAll<HTMLElement>('[data-ui="row"], [data-ui="row-exit"]')) {
        const rect = row.getBoundingClientRect();
        const opacity = more ? Math.max(0, Math.min(1, (bottom - rect.top) / 48)) : 1;
        row.style.setProperty('--scroll-opacity', String(opacity));
      }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const mutation = new MutationObserver(schedule);
    mutation.observe(body, { childList: true, subtree: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(body);
    element.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', schedule);
      mutation.disconnect(); cancelAnimationFrame(frame);
    };
  }, []);
  const height = table ? (compact ? 'h-[180px]' : 'h-[clamp(240px,48vh,560px)]') : 'max-h-[560px]';
  return (
    <div data-ui="scroll-fade" data-more={more} className="relative isolate min-w-0">
      <div
        ref={viewport}
        data-ui="fade-viewport"
        className={`[&_tbody_td:not(:last-child)]:[filter:opacity(var(--scroll-opacity,1))] [&_li[data-ui]]:[filter:opacity(var(--scroll-opacity,1))] overflow-auto overscroll-contain [scrollbar-width:thin] [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500 ${height}`}
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <div ref={content}>{children}</div>
      </div>
      <span
        data-ui="bottom-fade"
        aria-hidden="true"
        className={`pointer-events-none absolute right-3 bottom-0 left-0 z-20 h-12  transition-opacity duration-200 motion-reduce:transition-none  ${more ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}
