import { useState, type ReactNode } from "react";
import { SearchField } from "../shared/design-system/ui/SearchField";
import { NavigationItem } from "../shared/design-system/ui/NavigationItem";
import { NavigationSection } from "../shared/design-system/ui/NavigationSection";
import { SidebarNavigation } from "../shared/design-system/ui/SidebarNavigation";
import type { SettingsGroup } from "./settings-sections";
import { searchSettings, type SettingSearchEntry } from "./settings-search";

/** Both Settings hosts keep their existing navigation and scroll ownership. */
export function SettingsSearchNavigation({
  groups,
  children,
  onSection,
  onSetting,
}: {
  groups: readonly SettingsGroup[];
  children: ReactNode;
  onSection: (section: string) => void;
  onSetting: (setting: SettingSearchEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const searching = !!query.trim();
  const results = searchSettings(groups, query);
  return (
    <SidebarNavigation wrapSections>
      <div className="w-full min-w-0">
        <SearchField
          label="Search settings"
          placeholder="Search settings…"
          value={query}
          onValueChange={setQuery}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
      </div>
      {searching ? (
        <>
          <p role="status" className="m-0 w-full text-body-sm text-subtle">
            {results.length
              ? `${results.length} ${results.length === 1 ? "result" : "results"}`
              : "No settings found. Try another search."}
          </p>
          {groups.flatMap((group) =>
            group.sections.map((section) => {
              const matches = results.filter(
                (result) => result.section === section.id,
              );
              if (!matches.length) return null;
              return (
                <NavigationSection key={section.id} label={section.label}>
                  {matches.map((result) => (
                    <NavigationItem
                      key={result.setting?.id ?? section.id}
                      multiline
                      label={
                        <>
                          <span className="block">
                            {result.setting?.label ?? `Open ${result.label}`}
                          </span>
                          {result.setting?.hint && (
                            <span className="block text-caption text-subtle">
                              {result.setting.hint}
                            </span>
                          )}
                        </>
                      }
                      onClick={() =>
                        result.setting
                          ? onSetting(result.setting)
                          : onSection(section.id)
                      }
                    />
                  ))}
                </NavigationSection>
              );
            }),
          )}
        </>
      ) : (
        children
      )}
    </SidebarNavigation>
  );
}
