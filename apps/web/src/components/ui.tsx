import { Children, useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle, CircleAlert } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { StableText } from './stable-text';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  HTMLAttributes,
} from 'react';

const focus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900';
export function Button({
  className = '',
  variant = 'default',
  children,
  status,
  autoDismiss = true,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'quiet' | 'text';
  status?: 'idle' | 'pending' | 'success' | 'error';
  autoDismiss?: boolean;
}) {
  useLanguage();
  const labelId = useId();
  const [feedback, setFeedback] = useState(status ?? 'idle');
  const started = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (status === undefined) return;
    timers.current.forEach(clearTimeout);
    if (status === 'pending') started.current = Date.now();
    if (status === 'idle' || status === 'pending') { setFeedback(status); return; }
    const delay = status === 'success' ? Math.max(0, 1200 - (Date.now() - started.current)) : 0;
    timers.current = [setTimeout(() => {
      setFeedback(status);
      if (autoDismiss) timers.current.push(setTimeout(() => setFeedback('idle'), status === 'success' ? 1000 : 1800));
    }, delay)];
    return () => timers.current.forEach(clearTimeout);
  }, [status, autoDismiss]);
  const normal = Children.map(children, (child) => typeof child === 'string' ? <StableText text={child} /> : child);
  const labels = { pending: t('正在处理…'), success: t('操作成功'), error: t('操作失败') };
  const variants = {
    default:
      'border border-zinc-200 bg-white enabled:hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:enabled:hover:bg-zinc-800',
    primary:
      'border border-blue-600 bg-blue-600 text-white shadow-sm enabled:hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-500 dark:enabled:hover:bg-blue-400',
    quiet: 'border border-transparent bg-transparent enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800',
    text: 'border-0 bg-transparent px-0 text-blue-600 enabled:hover:text-blue-700 dark:text-blue-400 dark:enabled:hover:text-blue-300',
  };
  return (
    <button
      aria-labelledby={props['aria-label'] ? undefined : labelId}
      data-feedback={feedback}
      aria-busy={feedback === 'pending'}
      className={`action-button inline-flex font-sans min-h-9 shrink-0 cursor-pointer touch-manipulation select-none items-center justify-center gap-2 [&_svg]:shrink-0 rounded-lg px-3 py-2 text-[13px] leading-5 font-medium disabled:cursor-default disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none ${focus} ${variants[variant]} ${className}`}
      {...props}
      disabled={props.disabled || status === 'pending' || (status !== undefined && feedback === 'pending')}
      onClick={async event => {
        if (status !== undefined) { props.onClick?.(event); return; }
        timers.current.forEach(clearTimeout);
        setFeedback('pending');
        const start = Date.now();
        try {
          await props.onClick?.(event);
          timers.current = [setTimeout(() => {
            setFeedback('success');
            timers.current.push(setTimeout(() => setFeedback('idle'), 1000));
          }, Math.max(0, 1200 - (Date.now() - start)))];
        } catch {
          setFeedback('error');
          timers.current = [setTimeout(() => setFeedback('idle'), 1800)];
        }
      }}
    >
      <span className="button-surface" aria-hidden="true" />
      <span id={labelId} className="button-label inline-flex items-center gap-2">{normal}</span>
      <span className="button-feedback" aria-hidden="true">
        {feedback === 'pending' ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" /> : feedback === 'success' ? <Check size={18} className="morph-check" /> : feedback === 'error' ? <CircleAlert size={18} /> : null}
      </span>
      <span className="sr-only" role="status">{feedback === 'idle' ? '' : labels[feedback]}</span>
    </button>
  );
}
const field = `font-sans w-full min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base leading-5 text-zinc-900 md:text-[13px] dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 ${focus}`;
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const [invalid, setInvalid] = useState(false);
  if (props.type === 'checkbox') return <JellyToggle className={className} {...props} />;
  return <span className="field-control">
    <input
      {...props}
      className={`${field} ${className}`}
      aria-invalid={invalid || undefined}
      aria-describedby={[props['aria-describedby'], invalid ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
      onBlur={event => { setInvalid(!event.currentTarget.validity.valid); props.onBlur?.(event); }}
      onInvalid={event => { setInvalid(true); props.onInvalid?.(event); }}
      onChange={event => { props.onChange?.(event); if (invalid) setInvalid(!event.currentTarget.validity.valid); }}
    />
    {invalid && <span id={`${id}-error`} className="field-error" role="alert">{t('请检查此项的格式、范围和必填要求。')}</span>}
  </span>;
}
export function JellyToggle({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [direction, setDirection] = useState('');
  return <span className={`jelly-toggle ${className}`}>
    <input {...props} type="checkbox" role="switch" onChange={event => { setDirection(event.currentTarget.checked ? 'on' : 'off'); props.onChange?.(event); }} />
    <span className="jelly-track" aria-hidden="true"><span className="jelly-thumb" data-slide={direction} /></span>
  </span>;
}
export function SegmentedChoice({ label, value, options, onChange, disabled = false, ui }: {
  label: string; value: string; options: { value: string; label: string }[];
  onChange: (value: string, element: HTMLInputElement) => void; disabled?: boolean; ui?: string;
}) {
  const name = useId();
  return <fieldset className="setting-row" disabled={disabled} data-ui={ui}>
    <legend className="sr-only">{label}</legend>
    <span aria-hidden="true"><StableText text={label} /></span>
    <span className="segmented-choice">
      {options.map(option => <label key={option.value}>
        <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={event => onChange(option.value, event.currentTarget)} />
        <span><StableText text={option.label} /></span>
      </label>)}
    </span>
  </fieldset>;
}
export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${field} ${className}`} {...props} />;
}
export function Panel({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      data-stagger-item=""
      className={`mb-6 min-w-0 rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-[0_2px_5px_#20203004,0_14px_32px_#20203006] md:p-6 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-none ${className}`}
      {...props}
    />
  );
}
export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'blue' | 'danger';
  children: React.ReactNode;
}) {
  const tones = {
    neutral: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    danger: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  };
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function BrandLogo() {
  return (
    <svg data-ui="brand-logo" viewBox="0 0 40 40" role="img" aria-label="Orders3" className="size-10 shrink-0 text-zinc-900 dark:text-zinc-100">
      <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="4" />
    </svg>
  );
}
