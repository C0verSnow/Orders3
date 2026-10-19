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
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'quiet' | 'text';
}) {
  const variants = {
    default:
      'border border-zinc-200 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800',
    primary:
      'border border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400',
    quiet: 'border border-transparent bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800',
    text: 'border-0 bg-transparent px-0 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300',
  };
  return (
    <button
      className={`inline-flex min-h-9 shrink-0 cursor-pointer touch-manipulation select-none items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-[background-color,color,border-color,transform] duration-300 ease-[cubic-bezier(.22,1,.36,1)] active:scale-[.98] disabled:cursor-default disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none ${focus} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
const field = `w-full min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 md:text-[13px] dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 ${focus}`;
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
