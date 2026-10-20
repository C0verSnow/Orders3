import { t, useLanguage } from '../i18n';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function Navigation({ children }: { children: ReactNode }) {
  useLanguage();
  const nav = useRef<HTMLElement>(null),
    target = useRef<HTMLElement | null>(null);
  const [indicator, setIndicator] = useState({ x: 0, y: 0, width: 0, height: 0, visible: false });
  const move = (element: HTMLElement) => {
    const button = element.closest('button');
    if (!button || !nav.current?.contains(button)) return;
    target.current = button;
    setIndicator({
      x: button.offsetLeft,
      y: button.offsetTop,
      width: button.offsetWidth,
      height: button.offsetHeight,
      visible: true,
    });
  };
  const hide = () => {
    target.current = null;
    setIndicator((current) => ({ ...current, visible: false }));
  };
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (target.current) move(target.current);
    });
    observer.observe(nav.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <nav
      className="relative isolate grid gap-1.5"
      ref={nav}
      aria-label={t('主要导航')}
      onPointerOver={(event) => {
        if (event.pointerType === 'mouse' || event.pointerType === 'pen')
          move(event.target as HTMLElement);
      }}
      onPointerLeave={hide}
      onFocus={(event) => move(event.target)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) hide();
      }}
    >
      <span
        data-ui="nav-indicator"
        className="pointer-events-none absolute top-0 left-0 -z-10 rounded-xl bg-zinc-200/70 transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none dark:bg-zinc-700/70"
        aria-hidden="true"
        style={{
          width: indicator.width,
          height: indicator.height,
          opacity: indicator.visible ? 1 : 0,
          transform: `translate(${indicator.x}px,${indicator.y}px)`,
        }}
      />
      {children}
    </nav>
  );
}
