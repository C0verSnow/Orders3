import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from './ui';
import type { Theme } from '../hooks/use-theme';
import { t, useLanguage, setLanguage, persistLanguage } from '../i18n';
import { circularReveal } from '../circular-reveal';

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
      <Button
        variant="quiet"
        data-ui="theme-switch"
        aria-label={t('切换主题')}
        title={t('切换主题')}
        onClick={(event) => {
          const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
          void circularReveal(event.currentTarget, () => setTheme(next));
        }}
        className="size-9 p-2!"
      >
        {theme === 'system' ? <Monitor size={17} aria-hidden="true" /> : theme === 'dark' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
      </Button>
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
