# UI primitives

Pi Desktop styles the way Codex / DSH do: **tokens + a few primitives**, not a new CSS class per screen.

## Layers

1. **Tokens** — `src/renderer/ui/tokens.css` (`--ds-*`, type, radius, motion).
2. **Primitives** — this folder: `Button`, `Menu`, `Modal`, `Field`, `Switch`, `Segmented`. Each owns its CSS.
3. **Shell** — `styles.css` (app frame). `sidebar.css`, `chat.css`, `composer.css`, `files.css`.
4. **Pages** — `pages.css` (settings, models, plugins, skills, dialogs).
5. **Markdown / terminal** — `markdown.css`, `terminal-panel.css`.

## Adding UI

- A chrome control is `Button` / `Menu` / `Modal` / `Field` / `Switch` / `Segmented`, not a new `.foo-button`.
- List rows and disclosures use `Button variant="bare"` plus the existing row class. Do not restyle them as `ghost`/`sm`.
- On/off controls are `Switch`. Tab/scope/choice groups are `Segmented`.
- A new colour or type size is a token, not a one-off hex.
- Do not add a second overlay block at the bottom of `styles.css` to “fix” earlier rules. Change the primitive or the token.
- Do not split `styles.css` into many files.

Pi’s only identity departure is warm paper ink `#f3f1ec`. Everything else stays on the token ladder.
