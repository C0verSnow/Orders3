import type {ReactNode} from "react";
import type {Message} from "../types";

export function Notice({message, id}: {message?: Message; id?: string}) {
  return <p id={id} className="notice" data-tone={message?.tone} role="status" hidden={!message?.text}>{message?.text}</p>;
}
export function Heading({eyebrow, title, children}: {eyebrow: string; title: string; children: ReactNode}) {
  return <div className="heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subtitle">{children}</p></div></div>;
}
export function Empty({children}: {children: ReactNode}) { return <div className="empty">{children}</div>; }
export function Value({children, className = ""}: {children: ReactNode; className?: string}) { return <span className={`value ${className}`}>{children}</span>; }
