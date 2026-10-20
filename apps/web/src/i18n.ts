import { useSyncExternalStore } from 'react';
import { english } from './messages';

export type Language = 'zh' | 'en';
let language: Language = 'zh';
try {
  if (localStorage.getItem('orders-language') === 'en') language = 'en';
} catch {
  /* Storage is optional. */
}
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const currentLanguage = () => language;
export function setLanguage(next: Language) {
  language = next;
  document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
  for (const listener of listeners) listener();
}
export function persistLanguage() {
  try {
    localStorage.setItem('orders-language', language);
  } catch {
    /* Switching still works. */
  }
}
export function useLanguage() {
  return useSyncExternalStore(subscribe, currentLanguage);
}
const templates = Object.entries(english)
  .filter(([key]) => /\{\d+\}/.test(key))
  .map(([key, value]) => ({
    pattern: new RegExp(
      '^' +
        key
          .split(/\{\d+\}/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('([\\s\\S]*?)') +
        '$',
    ),
    value,
    specificity: key.replace(/\{\d+\}/g, '').length,
  }))
  .sort((left, right) => right.specificity - left.specificity);
export function t(text: string | null | undefined, values: unknown[] = []): string {
  const source = text ?? '';
  let translated = language === 'en' ? (english[source] ?? source) : source;
  if (
    language === 'en' &&
    translated === source &&
    !values.length &&
    !Object.hasOwn(english, source)
  ) {
    for (const template of templates) {
      const match = source.match(template.pattern);
      if (match) {
        translated = template.value.replace(/\{(\d+)\}/g, (_, index: string) =>
          t(match[Number(index) + 1]),
        );
        break;
      }
    }
  }
  return translated.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
}
export const dateLocale = () => (language === 'en' ? 'en-US' : 'zh-CN');
setLanguage(language);
