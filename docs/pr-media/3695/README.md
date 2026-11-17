# Sidebar PR #3695 reviewer images

These screenshots use synthetic fixture data and disposable identities. They are illustrative. The expected appearance is unchanged by this refactor.

The matched comparisons use Chromium, a 1440 × 950 viewport, light theme and default text size. Filenames identify the captured commit and engine:

- `d88203ad0`: base.
- `5e0d297c5`: candidate production code. Later PR commits change documentation, fixture wiring and regression tests.
- `stars-groups`: default All pane with Starred and saved groups.
- `no-stars`: the first group sits directly below Team when Starred is empty.
- `create-reveal`: dragging a channel reveals the create-section target.

The separate geometry check found no differences in section and create-target gaps across 18 cases per engine in Chromium and WebKit. Screenshots do not replace that measurement or establish native-app validation.

The remaining candidate images use the existing browser app fixtures with three synthetic channels (General, Planning and Design), a saved Work group and two communities. They show All/Solo/Team, Primary → Secondary → Primary and Design after dragging it into Work. The capture journey passed in Chromium with retries disabled. These stills show the resulting views; they do not depict every intermediate drag or reconnect frame.
