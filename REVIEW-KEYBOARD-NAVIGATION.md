# Review Page Keyboard Navigation

Dispatch’s pull request review page is designed to work as a keyboard-first workspace. You can move between the major areas of the page, search within the part you are currently using, move through comments and hunks, and trigger review actions without taking your hands off the keyboard.

All shortcuts below are the default bindings. Users can change them in Settings.

## Main idea

Think of the review page as three main panes:

- Left review pane: triage or file tree
- Code view: the active diff
- Overview panel: overview, conversation, commits, and checks

The fastest way to move around is:

- `Tab`: move to the next pane
- `Shift+Tab`: move to the previous pane
- `/`: search the pane you are in

## Core navigation

Use these keys constantly while reviewing:

| Shortcut | What it does |
| --- | --- |
| `Tab` | Move to the next review pane |
| `Shift+Tab` | Move to the previous review pane |
| `f` | Focus the left review pane |
| `d` | Focus the code view |
| `p` | Focus the overview panel |
| `g` | Focus the floating review actions |
| `i` | Toggle the overview panel |
| `Cmd+\\` | Toggle the overview panel |
| `Cmd+B` | Toggle the app sidebar |

## File navigation

These shortcuts help you move through the PR itself:

| Shortcut | What it does |
| --- | --- |
| `]` | Next file |
| `[` | Previous file |
| `n` | Jump to the next unreviewed file |
| `v` | Toggle the current file as viewed |
| `{` | Previous hunk |
| `}` | Next hunk |

## Searching

`/` is context-aware on the review page.

- If focus is in the left review pane, `/` focuses the file filter.
- If focus is in the code view, `/` opens diff search.
- If focus is in the overview panel and the current tab supports search, `/` focuses that tab’s search box.

Search behavior by region:

- Files: filters the file list
- Diff: searches the current file diff
- Conversation: searches comments and thread content
- Commits: filters commits by message, author, or SHA
- Checks: filters checks by name or status

## Side panel tabs

You can jump directly to the main side panel tabs:

| Shortcut | What it does |
| --- | --- |
| `Cmd+Shift+O` | Open Overview |
| `Cmd+Shift+C` | Open Conversation |
| `Cmd+Shift+T` | Open Commits |
| `Cmd+Shift+X` | Open Checks |

Once the overview panel is focused, use:

- `ArrowLeft` and `ArrowRight` to move between tabs
- `/` to search within the current tab, when that tab supports search
- `Escape` to close the panel

## Comments and threads

Dispatch supports keyboard review of threads in both the diff and conversation panel.

| Shortcut | What it does |
| --- | --- |
| `c` | Next comment |
| `Shift+C` | Previous comment |
| `u` | Jump to the next unresolved thread |
| `r` | Reply to the focused thread |
| `e` | Resolve the focused thread |

Tips:

- Use `c` or `u` to land on a thread.
- Once a thread is focused, `r` opens the reply box for that thread.
- `e` activates the resolve button for the focused thread when that thread can be resolved.

## Review actions

The review actions live in the floating review bar at the bottom of the review page.

| Shortcut | What it does |
| --- | --- |
| `Cmd+Shift+A` | Arm approve |
| `Cmd+Shift+R` | Open request changes |
| `Cmd+Shift+M` | Arm merge |

Important safety behavior:

- Approve and merge do not submit immediately from the keyboard.
- The shortcut first focuses and arms the button.
- Press `Enter` to confirm the action.
- Move focus away or press a different key to cancel the armed state.
- Request changes opens the composer first, so you can review the message before sending.

## Typical review flow

One fast review loop looks like this:

1. Press `Tab` until you reach the left review pane or press `f`.
2. Use `/` to filter files if needed.
3. Use `]` and `[` to move between files.
4. In the diff, use `{` and `}` for hunk navigation.
5. Use `c`, `Shift+C`, or `u` to move through feedback.
6. Use `r` to reply or `e` to resolve as you go.
7. Press `Cmd+Shift+C` to jump into the conversation panel when needed.
8. Press `g` to focus the review bar when you are ready to finish.
9. Use `Cmd+Shift+A` then `Enter` to approve, or `Cmd+Shift+M` then `Enter` to merge.

## Discoverability and customization

- Press `?` anywhere in the app to open the keyboard shortcuts view.
- Open Settings to customize keybindings if the defaults do not match your habits.

## Notes

- Review-page shortcuts are intended to stay out of the way while you are typing in an input or composer.
- Some actions only work when the relevant UI is present. For example, panel search is only available in tabs that support it, and resolve only works when the focused thread exposes a resolve control.
