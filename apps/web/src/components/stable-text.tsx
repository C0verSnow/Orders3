import { english } from '../messages';

// Reserve both translations in the same grid cell. English sets the reference
// measure; Chinese may need more room. Hidden sizing text is never announced.
const chinese = new Map(Object.entries(english).map(([zh, en]) => [en, zh]));
export function StableText({ text }: { text: string }) {
  const en = Object.hasOwn(english, text) ? english[text] : text;
  const zh = chinese.get(text) ?? text;
  return (
    <span className="inline-grid min-w-0 text-left align-baseline" data-ui="stable-text">
      <span aria-hidden="true" data-text={en} className="text-measure invisible col-start-1 row-start-1" />
      <span aria-hidden="true" data-text={zh} className="text-measure invisible col-start-1 row-start-1" />
      <span className="col-start-1 row-start-1">{text}</span>
    </span>
  );
}
