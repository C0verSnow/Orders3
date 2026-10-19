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
const easing = 'cubic-bezier(0.22,1,0.36,1)';

// Render exact latest values immediately; only the decorative outgoing layer holds old text.
export function AnimatedValue({ value, text = false }: { value: string; text?: boolean }) {
  const reduced = useContext(ReducedMotion),
    incoming = useRef<HTMLSpanElement>(null),
    outgoing = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState({ value, previous: value, revision: 0, width: value.length });
  if (frame.value !== value)
    setFrame({
      value,
      previous: frame.value,
      revision: frame.revision + 1,
      width: Math.max(frame.width, value.length),
    });
  useLayoutEffect(() => {
    if (!frame.revision || reduced) return;
    const options = { duration: text ? 200 : 350, easing };
    const enter = incoming.current?.animate(
      [
        { opacity: 0, transform: text ? 'none' : 'translateY(65%)' },
        { opacity: 1, transform: 'none' },
      ],
      options,
    );
    const exit = outgoing.current?.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: text ? 'none' : 'translateY(-65%)' },
      ],
      options,
    );
    return () => {
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
  const [snapshot, setSnapshot] = useState({ items, exiting: [] as MotionItem[] });
  if (snapshot.items !== items) {
    const ids = new Set(items.map((item) => item.id));
    setSnapshot({
      items,
      exiting: snapshot.items.filter((item) => !ids.has(item.id)).slice(0, 20),
    });
  }
  useEffect(() => {
    if (!snapshot.exiting.length) return;
    const timer = setTimeout(() => setSnapshot((current) => ({ ...current, exiting: [] })), 200);
    return () => clearTimeout(timer);
  }, [snapshot.exiting]);
  const Tag = as,
    Item = as === 'tbody' ? 'tr' : 'li';
  return (
    <Tag className={className}>
      {items.map((item, index) => (
        <MotionItemView key={item.id} item={item} as={Item} index={index} />
      ))}
      {snapshot.exiting.map((item) => (
        <MotionItemView key={`exit-${item.id}`} item={item} as={Item} exiting />
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
    mounted = useRef(false);
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
      duration: exiting ? 200 : 280,
      delay: initial && !exiting ? Math.min(index, 5) * 25 : 0,
      easing: 'ease-out',
      fill: 'backwards',
    });
    return () => animation?.cancel();
  }, [item.version, reduced, exiting, index]);
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
    const update = () =>
      setMore(element.scrollHeight - element.clientHeight - element.scrollTop > 2);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(body);
    element.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, []);
  const height = table ? (compact ? 'h-[180px]' : 'h-[clamp(240px,48vh,560px)]') : 'max-h-[560px]';
  return (
    <div data-ui="scroll-fade" data-more={more} className="relative isolate min-w-0">
      <div
        ref={viewport}
        data-ui="fade-viewport"
        className={`overflow-auto overscroll-contain [scrollbar-width:thin] [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500 ${height}`}
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <div ref={content}>{children}</div>
      </div>
      <span
        data-ui="bottom-fade"
        aria-hidden="true"
        className={`pointer-events-none absolute right-3 bottom-0 left-0 z-20 h-12 bg-linear-to-b from-transparent to-white transition-opacity duration-200 motion-reduce:transition-none dark:to-zinc-900 ${more ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}
