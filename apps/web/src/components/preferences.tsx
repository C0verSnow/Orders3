import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from './ui';
import type { Theme } from '../hooks/use-theme';
import { t, useLanguage, setLanguage, persistLanguage } from '../i18n';
import { circularReveal } from '../circular-reveal';

const options = [
  { value: 'light', label: '浅色模式', short: '浅色', icon: Sun },
  { value: 'dark', label: '深色模式', short: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', short: '系统', icon: Monitor },
] as const;
export function Preferences({
  theme,
  setTheme,
}: {
  theme: Theme;
  setTheme: (value: Theme) => void;
}) {
  const language = useLanguage();
  return (
    <div className="flex shrink-0 items-center gap-2" data-ui="preferences">
      <div
        role="group"
        aria-label={t('外观主题')}
        className="flex items-center gap-0.5 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800"
      >
        {options.map((option) => (
          <Button
            key={option.value}
            variant="quiet"
            aria-label={t(option.label)}
            title={t(option.label)}
            aria-pressed={theme === option.value}
            onClick={(event) => {
              if (theme !== option.value)
                void circularReveal(event.currentTarget, () => setTheme(option.value));
            }}
            className={`w-9 lg:w-[100px] px-2! py-1.5! text-[11px]! ${theme === option.value ? 'bg-white! text-zinc-900 shadow-sm dark:bg-zinc-600! dark:text-white' : 'text-zinc-500 dark:text-zinc-400'}`}
          >
            <option.icon size={15} aria-hidden="true" />
            <span className="hidden lg:inline">{t(option.short)}</span>
          </Button>
        ))}
      </div>
      <Button
        variant="quiet"
        data-ui="language-switch"
        aria-label={t('切换语言')}
        title={language === 'zh' ? 'English' : '中文'}
        onClick={(event) => {
          void circularReveal(event.currentTarget, () =>
            setLanguage(language === 'zh' ? 'en' : 'zh'),
          ).then((changed) => {
            if (changed) persistLanguage();
          });
        }}
        className="min-w-[70px] gap-1.5! px-2!"
      >
        <Languages size={15} aria-hidden="true" />
        <span>{language === 'zh' ? 'ZH' : 'EN'}</span>
      </Button>
    </div>
  );
}
