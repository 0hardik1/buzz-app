import type { CSSProperties, ReactNode } from "react";
import type { DemoWidgetKind } from "./kinds";
import "./frame.css";

export type FrameValues = {
  inset: number;
  radius: number;
  gap: number;
};

export function WidgetFrame({
  kind,
  title,
  values,
  children,
}: {
  kind: DemoWidgetKind;
  title: string;
  values: FrameValues;
  children: ReactNode;
}) {
  return (
    <article
      className="widget-frame widget-preview"
      data-widget={kind}
      style={
        {
          "--widget-inset": `${values.inset / 16}rem`,
          "--widget-radius": `${values.radius / 16}rem`,
          "--widget-gap": `${values.gap / 16}rem`,
        } as CSSProperties
      }
    >
      <header className="widget-heading">
        <span className="text-body widget-muted">{title}</span>
      </header>
      <div className="widget-body">{children}</div>
    </article>
  );
}
