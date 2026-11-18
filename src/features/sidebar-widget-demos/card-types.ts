import type { ComponentType } from "react";
import type { DemoWidgetKind } from "./kinds";

export type CardProps = { variant: string };

export type CardDefinition = {
  id: DemoWidgetKind;
  title: string;
  subtitle: string;
  category: "Your ideas" | "Fresh ideas";
  purpose: string;
  how: string;
  source: string;
  component: ComponentType<CardProps>;
};
