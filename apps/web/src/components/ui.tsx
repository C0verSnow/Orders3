import { Children, useEffect, useState } from 'react';
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
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'quiet' | 'text';
  status?: 'idle' | 'pending' | 'success' | 'error';
}) {
  useLanguage();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(false);
    if (status === 'success' || status === 'error') {
      const timeout = window.setTimeout(() => setDismissed(true), 1800);
      return () => window.clearTimeout(timeout);
    }
  }, [status]);
  const feedback = dismissed && (status === 'success' || status === 'error') ? 'idle' : (status ?? 'idle');
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
      data-feedback={feedback}
      aria-busy={status === 'pending'}
      className={`action-button inline-flex font-sans min-h-9 shrink-0 cursor-pointer touch-manipulation select-none items-center justify-center gap-2 [&_svg]:shrink-0 rounded-lg px-3 py-2 text-[13px] leading-5 font-medium disabled:cursor-default disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none ${focus} ${variants[variant]} ${className}`}
      {...props}
      disabled={props.disabled || status === 'pending'}
    >
      {status === undefined ? normal : <span className="grid items-center justify-items-start" aria-live="polite" aria-atomic="true">
        <span className={`col-start-1 row-start-1 inline-flex items-center gap-2 ${feedback !== 'idle' ? 'invisible' : ''}`} aria-hidden={feedback !== 'idle'}>{normal}</span>
        {(['pending', 'success', 'error'] as const).map(state => <span key={state} className={`col-start-1 row-start-1 inline-flex items-center gap-2 ${feedback !== state ? 'invisible' : ''}`} aria-hidden={feedback !== state}>
          {state === 'pending' ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> : state === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}
          <StableText text={labels[state]} />
        </span>)}
      </span>}
    </button>
  );
}
const field = `font-sans w-full min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base leading-5 text-zinc-900 md:text-[13px] dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 ${focus}`;
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`${props.type === 'checkbox' ? 'size-4 shrink-0 accent-blue-600' : field} ${className}`}
      {...props}
    />
  );
}
export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${field} ${className}`} {...props} />;
}
export function Panel({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
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
