import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Only the latest value is accessible. Outgoing layers are decorative and never delay data.
export function AnimatedValue({ value, text = false }: { value: string; text?: boolean }) {
  const [frame, setFrame] = useState({ value, previous: value, revision: 0, width: value.length });
  if (frame.value !== value) setFrame({ value, previous: frame.value, revision: frame.revision + 1, width: Math.max(frame.width, value.length) });
  return <span className={`animated-value ${text ? 'text-transition' : ''}`} style={text ? undefined : { minWidth: `${frame.width}ch` }}>
    {frame.revision > 0 && <span key={`old-${frame.revision}`} className="value-out" aria-hidden="true">{frame.previous}</span>}
    <span key={frame.revision} className={frame.revision ? 'value-in' : ''}>{value}</span>
  </span>;
}

export function TwoToneTitle({ title, description, level = 2 }: { title: string; description: string; level?: 1 | 2 }) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return <div className={`two-tone-title title-level-${level}`}><Heading>{title}</Heading><p>{description}</p></div>;
}

type MotionItem = { id: string; version: string; content: ReactNode };
// Retain only departing rows for 200 ms. Current rows and values always render immediately.
export function MotionList({ items, as = 'tbody', className = '' }: { items: MotionItem[]; as?: 'tbody' | 'ol' | 'ul'; className?: string }) {
  const [snapshot, setSnapshot] = useState({ items, exiting: [] as MotionItem[] });
  if (snapshot.items !== items) {
    const ids = new Set(items.map(item => item.id));
    setSnapshot({ items, exiting: snapshot.items.filter(item => !ids.has(item.id)).slice(0, 20) });
  }
  useEffect(() => {
    if (!snapshot.exiting.length) return;
    const timer = setTimeout(() => setSnapshot(current => ({ ...current, exiting: [] })), 200);
    return () => clearTimeout(timer);
  }, [snapshot.exiting]);
  const Tag = as, Item = as === 'tbody' ? 'tr' : 'li';
  return <Tag className={className}>{items.map((item, index) => <MotionItemView key={item.id} item={item} as={Item} index={index}/>)}
    {snapshot.exiting.map(item => <Item key={`exit-${item.id}`} className="row-exit" aria-hidden="true" inert>{item.content}</Item>)}
  </Tag>;
}
function MotionItemView({ item, as: Tag, index }: { item: MotionItem; as: 'tr' | 'li'; index: number }) {
  const element = useRef<HTMLTableRowElement & HTMLLIElement>(null), previous = useRef(item.version);
  useLayoutEffect(() => {
    if (previous.current === item.version) return;
    previous.current = item.version;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = element.current?.animate([{ opacity: .55 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    return () => animation?.cancel();
  }, [item.version]);
  return <Tag ref={element} className="row-enter" style={{ animationDelay: `${Math.min(index, 5) * 25}ms` }}>{item.content}</Tag>;
}

// Observe both content and viewport; a short list or the final row is never faded.
export function ScrollFade({ children, className = '', label }: { children: ReactNode; className?: string; label: string }) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const element = viewport.current!, body = content.current!;
    const update = () => setMore(element.scrollHeight - element.clientHeight - element.scrollTop > 2);
    const observer = new ResizeObserver(update);
    observer.observe(element); observer.observe(body);
    element.addEventListener('scroll', update, { passive: true }); update();
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, []);
  return <div className={`scroll-fade ${more ? 'has-more' : ''}`}><div ref={viewport} className={`fade-viewport ${className}`} tabIndex={0} role="region" aria-label={label}><div ref={content}>{children}</div></div><span className="bottom-fade" aria-hidden="true"/></div>;
}
