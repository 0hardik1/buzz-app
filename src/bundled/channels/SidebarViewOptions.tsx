import { DEFAULT_ACTIVE_WINDOW_SECONDS } from "../../features/relay/sidebar-preferences";
import type { SidebarSortMode } from "../../features/relay/sidebar-sort";
import { Filter2Icon } from "../../shared/design-system/icons";
import { Field } from "../../shared/design-system/ui/Field";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  PopoverPopup,
  PopoverRoot,
  PopoverTrigger,
} from "../../shared/design-system/ui/Popover";
import { Radio, RadioGroup } from "../../shared/design-system/ui/RadioGroup";
import { Switch } from "../../shared/design-system/ui/Switch";
import type { SidebarFilter } from "./useSidebarFilters";
import styles from "./Channels.module.css";

const day = 86400;
/** Show choices: All and Unreads, then Active windows picked in place. */
const shows = [
  { value: "all", label: "All" },
  { value: "unreads", label: "Unreads" },
  { value: String(day), label: "Today" },
  { value: String(7 * day), label: "7 days" },
  { value: String(30 * day), label: "30 days" },
] as const;

export type SidebarViewFilter = {
  value: SidebarFilter;
  /** Differs from the card's default, so the button shows it. */
  filtered?: boolean;
  disabled?: boolean;
  activeWindowSeconds?: number | undefined;
  change: (mode: SidebarFilter, seconds?: number) => unknown;
};

/**
 * One popover for how a card shows its conversations: which ones, in what
 * order, and as a list or icons. Its button fills while the card is filtered.
 */
export function SidebarViewOptions({
  title,
  filter,
  sort,
  unreadsFirst,
  display,
}: {
  title: string;
  filter?: SidebarViewFilter | undefined;
  sort?:
    | {
        value: SidebarSortMode;
        modes?: readonly { id: SidebarSortMode; label: string }[];
        change: (mode: SidebarSortMode) => void;
      }
    | undefined;
  unreadsFirst?: { on: boolean; set: (on: boolean) => void } | undefined;
  display?:
    | { value: "list" | "icons"; set: (value: "list" | "icons") => void }
    | undefined;
}) {
  const show =
    filter?.value === "active"
      ? String(filter.activeWindowSeconds ?? DEFAULT_ACTIVE_WINDOW_SECONDS)
      : filter?.value;
  const label = `View options for ${title}`;
  return (
    <PopoverRoot>
      <PopoverTrigger
        render={
          <IconButton
            size="compact"
            variant={filter?.filtered ? "accent" : "ghost"}
            aria-label={filter?.filtered ? `${label}, filtered` : label}
            icon={<Filter2Icon size={14} />}
          />
        }
      />
      <PopoverPopup size="compact" align="end" aria-label={label}>
        <div className={styles.viewOptions}>
          {filter && (
            <Field label="Show" nativeLabel={false}>
              <RadioGroup
                layout="wrap"
                aria-label="Show"
                value={show}
                disabled={filter.disabled}
                onValueChange={(next) => {
                  const choice = String(next);
                  void Promise.resolve(
                    choice === "all" || choice === "unreads"
                      ? filter.change(choice)
                      : filter.change("active", Number(choice)),
                  ).catch(() => {});
                }}
              >
                {shows.map((choice) => (
                  <Radio
                    key={choice.value}
                    value={choice.value}
                    label={choice.label}
                    variant="chip"
                  />
                ))}
              </RadioGroup>
            </Field>
          )}
          {sort && (
            <Field label="Sort" nativeLabel={false}>
              <RadioGroup
                layout="wrap"
                aria-label="Sort"
                value={sort.value}
                onValueChange={(mode) => sort.change(mode as SidebarSortMode)}
              >
                <Radio value="recent" label="Recent" variant="chip" />
                <Radio value="alpha" label="A–Z" variant="chip" />
                {sort.modes?.map((mode) => (
                  <Radio
                    key={mode.id}
                    value={mode.id}
                    label={mode.label}
                    variant="chip"
                  />
                ))}
              </RadioGroup>
            </Field>
          )}
          {unreadsFirst && (
            <Switch
              label="Unreads first"
              checked={unreadsFirst.on}
              onCheckedChange={unreadsFirst.set}
            />
          )}
          {display && (
            <Field label="Layout" nativeLabel={false}>
              <RadioGroup
                layout="wrap"
                aria-label="Layout"
                value={display.value}
                onValueChange={(value) =>
                  display.set(value === "icons" ? "icons" : "list")
                }
              >
                <Radio value="list" label="List" variant="chip" />
                <Radio value="icons" label="Icons" variant="chip" />
              </RadioGroup>
            </Field>
          )}
        </div>
      </PopoverPopup>
    </PopoverRoot>
  );
}
