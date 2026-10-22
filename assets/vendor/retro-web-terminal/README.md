# R7 Slug Generator — original CRT renderer

Source: https://github.com/transitive-bullshit/retro-web-terminal
Commit: `cba0b1eb09b15409182f9666044c520fbe33dcf3` (version 0.2.0).

`upstream/` contains the original terminal adapter, GLSL effects, presets and
diagnostics dashboard. The CRT shaders also render the scrollbar so it follows
the same curvature, phosphor and glow as the terminal. A transparent curved
hit area handles dragging, track clicks, touch and keyboard scrolling; the
native scrollbar remains available when effects are off or WebGL fails.
The command pager also shows a scrollbar on its alternate screen.
The presets are unmodified. The dashboard's keyboard captions refer to returning
to the command prompt.

`adapter.ts` mounts this renderer directly in the existing HTML. React is only a
wrapper in the upstream library and is unnecessary for this integration. The
adapter manages disposal, display controls, the command shell and diagnostics.
No CSS simulation is used for CRT effects.

Each session starts with the Green Phosphor preset and CRT effects enabled.
The HTML retains the theme and display controls but hides them along with the
frame button, extra labels and links. Only the brand appears above the screen.
The frame is off by default; the `frame on`, `frame off` and `frame toggle`
commands control it.

`shell.ts` provides the default interactive prompt. It calls `createRetroServices()`
in the HTML for the existing slug algorithms, translation dictionary, NMT/cache,
category suffixes, URL replacement, alphabet, documentation and code snippets.
The bridge avoids triggering animations or changing focus in the hidden GUI.

Enter a title directly, or use `slug <title>`. `help` lists all commands:
`type`, `method`, `translit`, `translate`, `suffix`, `url`, `copy`, `edit`,
`history`, `status`, `docs`, `alphabet`, `code js|php|py`, `links`, `examples`,
`demo`, `frame`, `clear`, `reset`, `exit`. A leading `/` is also accepted.
Titles that start with a command name can be entered using `slug <title>`.

The editor supports Unicode, paste, history, Tab completion and cursor editing.
Clipboard text can be inserted with Ctrl+V or a right click inside the terminal.
Multiline clipboard content is flattened into one input without executing it.
Long help and code use a paged viewer; Escape returns to the prompt. `demo`
runs the original diagnostics in the alternate screen, preserving shell output.
Ctrl+C cancels pending translation without terminating the shared NMT worker;
late results cannot overwrite the next command. Clipboard errors and NMT fallback
are reported explicitly. Command/result history stays in memory for this tab.

To rebuild the checked-in browser assets with Node.js:

```sh
cd assets/vendor/retro-web-terminal
npm ci
npm run build
```

Output: `assets/retro-terminal/terminal.js`, `terminal.css`, local font files and
`LICENSES.txt`. The page lazily loads these assets on `l33t` + Enter and also works
when opened as a local HTML file. Deploy the HTML together with `assets/`.

The same pinned xterm versions as upstream are required because the renderer
captures xterm's completed WebGL frame through a private integration boundary.
The upstream fallback displays the terminal without CRT effects if WebGL2 is
unavailable.
