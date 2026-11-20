import { useState } from "react";
import { DEFAULT_ACTIVE_WINDOW_SECONDS } from "../../features/relay/sidebar-preferences";
import type { SidebarSortMode } from "../../features/relay/sidebar-sort";
import {
  ArrowsDownUpIcon,
  Filter2Icon,
  ListBulletsIcon,
  SquaresFourIcon,
} from "../../shared/design-system/icons";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuIcon,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuPopup,
  MenuSubmenuTrigger,
  MenuTrigger,
} from "../../shared/design-system/ui/Menu";
import type { SidebarFilter } from "./useSidebarFilters";

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
  /** Unreads only or a time range is on, unlike the default All. */
  filtered?: boolean;
  disabled?: boolean;
  activeWindowSeconds?: number | undefined;
  /** `null` seconds clears the saved date window. */
  change: (mode: SidebarFilter, seconds: number | null) => unknown;
};

export type SidebarViewSort = {
  value: SidebarSortMode;
  modes?: readonly { id: SidebarSortMode; label: string }[];
  change: (mode: SidebarSortMode) => void;
};

/** Unreads only, then the time range. Choices keep the menu open, so the two
 * can be combined. */
function FilterItems({ filter }: { filter: SidebarViewFilter }) {
  const unreads = filter.value === "unreads";
  // Active defaults to 30 days; Unreads spans all dates until one is saved.
  const seconds =
    filter.value === "active"
      ? (filter.activeWindowSeconds ?? DEFAULT_ACTIVE_WINDOW_SECONDS)
      : unreads
        ? filter.activeWindowSeconds
        : undefined;
  const date = seconds === undefined ? "all" : String(seconds);
  // A saved window this menu doesn't offer stays visible and selected.
  const options = dates.some((option) => option.value === date)
    ? dates
    : [...dates, { value: date, label: `${(seconds ?? 0) / day} days` }];
  const change = (nextUnreads: boolean, nextDate: string) =>
    void Promise.resolve(
      filter.change(
        nextUnreads ? "unreads" : nextDate === "all" ? "all" : "active",
        nextDate === "all" ? null : Number(nextDate),
      ),
    ).catch(() => {});
  return (
    <>
      <MenuCheckboxItem
        checked={unreads}
        disabled={filter.disabled}
        onCheckedChange={(on) => change(on, date)}
      >
        Unreads only
      </MenuCheckboxItem>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel emphasis="quiet">Time range</MenuGroupLabel>
        <MenuRadioGroup
          value={date}
          onValueChange={(next) => change(unreads, String(next))}
        >
          {options.map((option) => (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              disabled={filter.disabled}
              selection="highlight"
            >
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
    </>
  );
}

/**
 * A card's view choices in its ••• menu: Filter and Sort as submenus, then
 * Layout at the top level since it neither filters nor sorts.
 */
export function SidebarViewMenuItems({
  title,
  filter,
  sort,
  unreadsFirst,
  display,
}: {
  title: string;
  filter?: SidebarViewFilter | undefined;
  sort?: SidebarViewSort | undefined;
  unreadsFirst?: { on: boolean; set: (on: boolean) => void } | undefined;
  display?:
    | { value: "list" | "icons"; set: (value: "list" | "icons") => void }
    | undefined;
}) {
  if (!filter && !sort && !unreadsFirst && !display) return null;
  return (
    <>
      {filter && (
        <MenuSubmenu>
          <MenuSubmenuTrigger>
            <MenuIcon>
              <Filter2Icon size={14} />
            </MenuIcon>
            Filter
          </MenuSubmenuTrigger>
          <MenuSubmenuPopup aria-label={`Filter ${title}`} finalFocus={false}>
            <FilterItems filter={filter} />
          </MenuSubmenuPopup>
        </MenuSubmenu>
      )}
      {(sort || unreadsFirst) && (
        <MenuSubmenu>
          <MenuSubmenuTrigger>
            <MenuIcon>
              <ArrowsDownUpIcon size={14} />
            </MenuIcon>
            Sort
          </MenuSubmenuTrigger>
          <MenuSubmenuPopup aria-label={`Sort ${title}`} finalFocus={false}>
            {sort && (
              <MenuRadioGroup
                value={sort.value}
                onValueChange={(mode) => sort.change(mode as SidebarSortMode)}
              >
                <MenuRadioItem value="recent" selection="highlight">
                  Recent
                </MenuRadioItem>
                <MenuRadioItem value="alpha" selection="highlight">
                  A–Z
                </MenuRadioItem>
                {/* Only when a plugin contributes its own order. */}
                {sort.modes?.map((mode) => (
                  <MenuRadioItem
                    key={mode.id}
                    value={mode.id}
                    selection="highlight"
                  >
                    {mode.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            )}
            {sort && unreadsFirst && <MenuSeparator />}
            {unreadsFirst && (
              <MenuCheckboxItem
                checked={unreadsFirst.on}
                // Unreads only leaves nothing else to put first.
                disabled={filter?.value === "unreads"}
                onCheckedChange={unreadsFirst.set}
              >
                Unreads first
              </MenuCheckboxItem>
            )}
          </MenuSubmenuPopup>
        </MenuSubmenu>
      )}
      {display && (
        <>
          {(filter || sort || unreadsFirst) && <MenuSeparator />}
          <MenuGroup>
            <MenuGroupLabel emphasis="quiet">Layout</MenuGroupLabel>
            <MenuRadioGroup
              value={display.value}
              onValueChange={(value) =>
                display.set(value === "icons" ? "icons" : "list")
              }
            >
              <MenuRadioItem value="list" selection="highlight">
                <MenuIcon>
                  <ListBulletsIcon size={14} />
                </MenuIcon>
                List
              </MenuRadioItem>
              <MenuRadioItem value="icons" selection="highlight">
                <MenuIcon>
                  <SquaresFourIcon size={14} />
                </MenuIcon>
                Icons
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        </>
      )}
    </>
  );
}

/** The card's filter icon: a shortcut to the same choices as its Filter
 * submenu. It keeps the card's other actions' color whether or not a filter
 * is on; its accessible name says when one is. */
export function SidebarFilterButton({
  title,
  filter,
}: {
  title: string;
  filter: SidebarViewFilter;
}) {
  const [open, setOpen] = useState(false);
  const label = `Filter ${title}`;
  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={(props) => (
          <IconButton
            {...props}
            size="compact"
            aria-label={filter.filtered ? `${label}, filtered` : label}
            icon={<Filter2Icon size={14} />}
          />
        )}
      />
      <MenuPopup align="end" aria-label={label}>
        <FilterItems filter={filter} />
      </MenuPopup>
    </MenuRoot>
  );
}
