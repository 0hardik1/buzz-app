import { DEFAULT_ACTIVE_WINDOW_SECONDS } from "../../features/relay/sidebar-preferences";
import type { SidebarSortMode } from "../../features/relay/sidebar-sort";
import {
  Filter2Icon,
  ListBulletsIcon,
  SquaresFourIcon,
} from "../../shared/design-system/icons";
import { Field } from "../../shared/design-system/ui/Field";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  PopoverPopup,
  PopoverRoot,
  PopoverTrigger,
} from "../../shared/design-system/ui/Popover";
import { Radio, RadioGroup } from "../../shared/design-system/ui/RadioGroup";
import { PreferenceRow } from "../../shared/design-system/ui/PreferenceRow";
import { Select } from "../../shared/design-system/ui/Select";
import { SwitchPreferenceRow } from "../../shared/design-system/ui/SwitchPreferenceRow";
import type { SidebarFilter } from "./useSidebarFilters";
import styles from "./Channels.module.css";

const day = 86400;
const dates = [
  { value: "all", label: "All" },
  { value: String(day), label: "Today" },
  { value: String(3 * day), label: "3 days" },
  { value: String(7 * day), label: "7 days" },
  { value: String(30 * day), label: "30 days" },
] as const;

export type SidebarViewFilter = {
  value: SidebarFilter;
  /** Differs from the card's default, so the button shows it. */
  filtered?: boolean;
  disabled?: boolean;
  activeWindowSeconds?: number | undefined;
  /** `null` seconds clears the saved date window. */
  change: (mode: SidebarFilter, seconds: number | null) => unknown;
};

/**
 * One popover for how a card shows its conversations: which ones, in what
 * order, and as a list or icons. Its icon takes the accent while filtered.
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
  const unreads = filter?.value === "unreads";
  // Active defaults to 30 days; Unreads spans all dates until one is saved.
  const seconds =
    filter?.value === "active"
      ? (filter.activeWindowSeconds ?? DEFAULT_ACTIVE_WINDOW_SECONDS)
      : unreads
        ? filter.activeWindowSeconds
        : undefined;
  const date = seconds === undefined ? "all" : String(seconds);
  // A saved window this menu doesn't offer stays visible and selected.
  const dateOptions = dates.some((option) => option.value === date)
    ? dates
    : [...dates, { value: date, label: `${(seconds ?? 0) / day} days` }];
  const change = (nextUnreads: boolean, nextDate: string) =>
    void Promise.resolve(
      filter?.change(
        nextUnreads ? "unreads" : nextDate === "all" ? "all" : "active",
        nextDate === "all" ? null : Number(nextDate),
      ),
    ).catch(() => {});
  const label = `View options for ${title}`;
  return (
    <PopoverRoot>
      <PopoverTrigger
        render={
          <IconButton
            size="compact"
            tone={filter?.filtered ? "accent" : undefined}
            aria-label={filter?.filtered ? `${label}, filtered` : label}
            icon={<Filter2Icon size={14} />}
          />
        }
      />
      <PopoverPopup size="compact" align="end" aria-label={label}>
        <div className={styles.viewOptions}>
          {filter && (
            <>
              <SwitchPreferenceRow
                label="Unreads"
                checked={unreads}
                disabled={filter.disabled}
                onCheckedChange={(on) => change(on, date)}
              />
              <Select
                variant="preference"
                label="Date"
                align="end"
                value={date}
                disabled={filter.disabled === true}
                groups={[{ label: "", options: dateOptions }]}
                onValueChange={(next) => change(unreads, next)}
              />
            </>
          )}
          {sort && (
            <PreferenceRow
              title="Sort"
              trailing={
                <Field
                  label="Sort"
                  labelVisibility="hidden"
                  nativeLabel={false}
                >
                  <RadioGroup
                    layout="wrap"
                    aria-label="Sort"
                    value={sort.value}
                    onValueChange={(mode) =>
                      sort.change(mode as SidebarSortMode)
                    }
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
              }
            />
          )}
          {unreadsFirst && (
            // Unreads already leaves only unread conversations to order.
            <SwitchPreferenceRow
              label="Unreads first"
              checked={unreadsFirst.on}
              disabled={unreads}
              onCheckedChange={unreadsFirst.set}
            />
          )}
          {display && (
            <PreferenceRow
              title="Layout"
              trailing={
                <Field
                  label="Layout"
                  labelVisibility="hidden"
                  nativeLabel={false}
                >
                  <RadioGroup
                    layout="wrap"
                    aria-label="Layout"
                    value={display.value}
                    onValueChange={(value) =>
                      display.set(value === "icons" ? "icons" : "list")
                    }
                  >
                    <Radio
                      value="list"
                      variant="chip"
                      label={
                        <>
                          <ListBulletsIcon size={14} aria-hidden="true" />
                          <span className="sr-only">List</span>
                        </>
                      }
                    />
                    <Radio
                      value="icons"
                      variant="chip"
                      label={
                        <>
                          <SquaresFourIcon size={14} aria-hidden="true" />
                          <span className="sr-only">Icons</span>
                        </>
                      }
                    />
                  </RadioGroup>
                </Field>
              }
            />
          )}
        </div>
      </PopoverPopup>
    </PopoverRoot>
  );
}
