# R7 Slug Generator — original CRT renderer

Source: https://github.com/transitive-bullshit/retro-web-terminal
Commit: `cba0b1eb09b15409182f9666044c520fbe33dcf3` (version 0.2.0).

`upstream/` contains the original terminal adapter, GLSL effects, presets and
diagnostics dashboard. The renderer, shaders and presets are unmodified. The
dashboard's keyboard captions refer to returning to the generator; no demo shell
or slug commands are connected. Its type-only import is preserved.

`adapter.ts` mounts this renderer directly in the existing HTML. React is only a
wrapper in the upstream library and is unnecessary for this integration. The
adapter manages disposal, display controls and the original demo's diagnostics.
No CSS simulation is used for CRT effects.

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
unavailable; the UI reports that fallback explicitly.
