// Preserve Fontsource's unicode ranges so Cyrillic subsets do not override Latin.
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './upstream/styles.css';
import { createTerminalSource, type TerminalSource } from './upstream/terminal-source';
import { resolveSettings, themes, parameterRanges, type ThemeName } from './upstream/settings';
import { createDashboard } from './upstream/demo/dashboard';
import { createSlugShell, type SlugServices } from './shell';

const fontFamily = '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace';
const effectNames = {
    glow: 'Bloom', scanlines: 'Scanlines', phosphor: 'Phosphor',
    curvature: 'Curvature', persistence: 'Afterglow', rgbShift: 'Color separation',
    noise: 'Noise', flicker: 'Flicker', glitch: 'Glitch', vignette: 'Vignette'
};

async function mount(view: HTMLElement, signal: AbortSignal, onExit: () => void, services: SlugServices) {
    const get = <T extends HTMLElement>(selector: string) => view.querySelector<T>(selector)!;
    const root = get<HTMLDivElement>('#retroRenderer');
    const host = get<HTMLDivElement>('.retro-terminal__source');
    // Upstream disposal loses the WebGL context. React creates a fresh canvas on
    // remount; the standalone HTML needs the same lifecycle explicitly.
    const previousCanvas = get<HTMLCanvasElement>('.retro-terminal__effects');
    const canvas = previousCanvas.cloneNode(false) as HTMLCanvasElement;
    previousCanvas.replaceWith(canvas);
    delete root.dataset.renderer;
    const loading = get<HTMLDivElement>('#retroLoading');
    const effects = get<HTMLButtonElement>('#retroEffectsBtn');
    const panel = get<HTMLDivElement>('#retroTuningPanel');
    const tuning = get<HTMLButtonElement>('#retroTuneBtn');
    const pause = get<HTMLButtonElement>('#retroPauseBtn');
    const frame = get<HTMLButtonElement>('#retroFrameBtn');
    const status = get<HTMLSpanElement>('#retroRendererStatus');
    const controls = get<HTMLDivElement>('#retroTuningControls');
    const inputs = new Map<string, HTMLInputElement>();
    const outputs = new Map<string, HTMLOutputElement>();
    // Each session starts with green phosphor and CRT effects. The HTML keeps
    // the other themes and display controls available in the code, but hidden.
    let theme: ThemeName = 'green';
    let settings = resolveSettings(theme, { effectsEnabled: true });
    let source: TerminalSource | undefined;
    let dashboard: ReturnType<typeof createDashboard> | undefined;
    let shell: ReturnType<typeof createSlugShell> | undefined;
    let disposed = false;
    let paused = false;
    let renderer = 'webgl';
    let dimensions = { cols: 0, rows: 0 };
    let keyboardInputHandled = false;
    let composingInput = false;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const listen = (element: EventTarget, event: string, fn: EventListener) =>
        element.addEventListener(event, fn, { signal });
    const updateStatus = () => {
        status.textContent = renderer === 'fallback'
            ? 'Basic display · WebGL2 недоступен'
            : `${dimensions.cols || '—'} × ${dimensions.rows || '—'}`;
        status.dataset.mode = renderer;
    };
    const read = (path: string) => path.split('.').reduce((object, key) => object[key], settings as any);
    const sync = () => {
        view.dataset.phosphor = theme;
        view.style.setProperty('--retro-phosphor', themes[theme].accent);
        view.querySelectorAll<HTMLButtonElement>('[data-retro-theme]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.retroTheme === theme));
        });
        effects.setAttribute('aria-checked', String(settings.effectsEnabled));
        for (const [path, input] of inputs) {
            const value = read(path);
            if (input.type === 'checkbox') input.checked = value;
            else {
                input.value = String(value);
                outputs.get(path)!.value = String(value);
            }
        }
    };
    const apply = () => {
        source?.update(theme, settings, fontFamily, 14);
        sync();
    };
    const addControl = (container: HTMLElement, path: string, name: string, range?: { min: number; max: number; step: number }) => {
        const label = document.createElement('label');
        label.className = 'retro-tuning-row';
        const title = document.createElement('span');
        title.textContent = name;
        const input = document.createElement('input');
        input.id = `retro-setting-${path.replace('.', '-')}`;
        input.type = range ? 'range' : 'checkbox';
        label.htmlFor = input.id;
        label.append(title, input);
        if (range) {
            input.min = String(range.min);
            input.max = String(range.max);
            input.step = String(range.step);
            const output = document.createElement('output');
            output.htmlFor = input.id;
            label.append(output);
            outputs.set(path, output);
        }
        inputs.set(path, input);
        listen(input, 'input', () => {
            const keys = path.split('.');
            const object = keys.length === 1 ? settings : settings[keys[0]];
            object[keys.at(-1)!] = range ? Number(input.value) : input.checked;
            apply();
        });
        container.append(label);
    };
    const group = (name: string, open = false) => {
        const details = document.createElement('details');
        details.open = open;
        const summary = document.createElement('summary');
        summary.textContent = name;
        details.append(summary);
        controls.append(details);
        return details;
    };

    function setPaused(value: boolean) {
        if (paused !== value) dashboard?.input('p');
        paused = value;
        pause.setAttribute('aria-pressed', String(value));
        get<HTMLSpanElement>('#retroPauseLabel').textContent = value ? 'resume' : 'pause';
    }
    function startDashboard() {
        dashboard?.dispose();
        source!.terminal.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[H');
        dashboard = createDashboard({
            write: data => source!.terminal.write(data),
            getSize: () => ({ cols: source!.terminal.cols, rows: source!.terminal.rows })
        });
        paused = false;
        dashboard.enter();
        setPaused(motion.matches);
    }
    function stopDashboard() {
        dashboard?.dispose();
        dashboard = undefined;
        shell?.resume();
    }
    function toggleFrame(mode?: string) {
        const framed = ['show', 'on', 'вкл', 'включить'].includes(mode || '')
            ? true
            : ['hide', 'off', 'выкл', 'выключить'].includes(mode || '')
                ? false
                : frame.getAttribute('aria-pressed') !== 'true';
        frame.setAttribute('aria-pressed', String(framed));
        frame.textContent = framed ? '▣ Hide frame' : '▣ Show frame';
        get('.retro-monitor').classList.toggle('retro-monitor--bare', !framed);
        return framed;
    }
    function handleInput(data: string) {
        if (dashboard) {
            if (data === '\x1b' || data === 'q' || data === 'Q' || data === '\x03') stopDashboard();
            else if (data === 'p' || data === 'P' || data === ' ') setPaused(!paused);
            else dashboard.input(data);
        } else shell?.input(data);
    }
    const setPanel = (open: boolean) => {
        panel.hidden = !open;
        tuning.setAttribute('aria-expanded', String(open));
        if (open) get<HTMLButtonElement>('#retroTuningClose').focus();
        else tuning.focus();
    };
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        dashboard?.dispose();
        shell?.dispose();
        source?.dispose();
        source = undefined;
        delete root.dataset.renderer;
        panel.hidden = true;
        tuning.setAttribute('aria-expanded', 'false');
        controls.replaceChildren();
        loading.hidden = false;
        loading.textContent = 'INITIALIZING DISPLAY';
    };
    signal.addEventListener('abort', dispose, { once: true });

    try {
        sync();
        await document.fonts.load('14px "IBM Plex Mono"', 'R7 Генератор слагов');
        if (signal.aborted) return;
        source = await createTerminalSource(root, host, canvas, {
            theme, settings, fontFamily, fontSize: 14,
            onData(data) {
                keyboardInputHandled = true;
                handleInput(data);
            },
            onResize(size) {
                dimensions = size;
                dashboard?.resize(size.cols, size.rows);
                shell?.resize();
                updateStatus();
            },
            onRendererChange(mode) {
                renderer = mode;
                updateStatus();
            },
            pager: {
                position: () => shell?.pagerPosition(),
                scrollTo: top => shell?.scrollPager(top),
                scrollLines: amount => shell?.scrollPagerLines(amount)
            }
        }, signal);
        if (signal.aborted || !source) {
            source?.dispose();
            return;
        }

        controls.replaceChildren();
        const display = group('Display', true);
        addControl(display, 'effectsEnabled', 'Enabled');
        addControl(display, 'brightness', 'Brightness', parameterRanges.brightness);
        addControl(display, 'contrast', 'Contrast', parameterRanges.contrast);
        for (const [key, label] of Object.entries(effectNames)) {
            const section = group(label, key === 'curvature');
            addControl(section, `${key}.enabled`, 'Enabled');
            for (const [parameter, range] of Object.entries(parameterRanges[key])) {
                addControl(section, `${key}.${parameter}`, parameter[0].toUpperCase() + parameter.slice(1), range as any);
            }
        }
        view.querySelectorAll<HTMLButtonElement>('[data-retro-theme]').forEach(button => {
            listen(button, 'click', () => {
                theme = button.dataset.retroTheme as ThemeName;
                settings = resolveSettings(theme);
                apply();
                source?.terminal.focus();
            });
        });
        listen(effects, 'click', () => {
            settings.effectsEnabled = !settings.effectsEnabled;
            apply();
        });
        listen(get('#retroResetBtn'), 'click', () => {
            settings = resolveSettings(theme);
            apply();
            if (dashboard) startDashboard();
            else shell?.reset();
            source?.terminal.focus();
        });
        listen(pause, 'click', () => setPaused(!paused));
        listen(motion, 'change', () => { if (motion.matches) setPaused(true); });
        listen(tuning, 'click', () => setPanel(panel.hidden));
        listen(get('#retroTuningClose'), 'click', () => setPanel(false));
        listen(frame, 'click', () => {
            toggleFrame();
            source?.terminal.focus();
        });
        listen(root, 'wheel', ((event: WheelEvent) => {
            if (shell?.wheel(event.deltaY)) event.preventDefault();
        }) as EventListener);
        listen(view, 'keydown', ((event: KeyboardEvent) => {
            if (event.key === 'Escape' && !panel.hidden) {
                event.preventDefault();
                event.stopPropagation();
                setPanel(false);
            }
        }) as EventListener);

        dimensions = { cols: source.terminal.cols, rows: source.terminal.rows };
        source.update(theme, settings, fontFamily, 14);
        sync();
        updateStatus();
        shell = createSlugShell(source.terminal, services, signal, {
            exit: onExit, demo: startDashboard, frame: toggleFrame
        });
        const pasteIntoShell = (text: string) => {
            if (!text || signal.aborted) return;
            if (dashboard) stopDashboard();
            shell?.paste(text);
            source?.terminal.focus();
        };
        root.addEventListener('paste', ((event: ClipboardEvent) => {
            const text = event.clipboardData?.getData('text/plain') || '';
            if (!text) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            pasteIntoShell(text);
        }) as EventListener, { signal, capture: true });
        root.addEventListener('contextmenu', ((event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (dashboard) stopDashboard();
            source?.terminal.focus();
            if (!navigator.clipboard?.readText) {
                shell?.notice('Буфер обмена недоступен. Используйте Ctrl+V.');
                return;
            }
            void navigator.clipboard.readText()
                .then(text => {
                    if (text) pasteIntoShell(text);
                    else shell?.notice('Буфер обмена пуст.');
                })
                .catch(() => shell?.notice('Не удалось прочитать буфер. Используйте Ctrl+V.'));
        }) as EventListener, { signal });
        const input = source.terminal.textarea;
        if (input) {
            input.setAttribute('aria-label', 'Команда или заголовок для слага');
            input.setAttribute('autocapitalize', 'off');
            input.setAttribute('autocomplete', 'off');
            input.setAttribute('autocorrect', 'off');
            input.enterKeyHint = 'go';
            input.spellcheck = false;
            // xterm 6 ignores input-only text while screenReaderMode is enabled.
            // Handle mobile keyboards without duplicating keypress/IME input.
            // Capture on the ancestor before xterm's textarea keydown listener.
            root.addEventListener('keydown', () => { keyboardInputHandled = false; }, { signal, capture: true });
            root.addEventListener('keyup', () => { keyboardInputHandled = false; }, { signal, capture: true });
            listen(input, 'compositionstart', () => { composingInput = true; });
            listen(input, 'compositionend', () => { setTimeout(() => { composingInput = false; }, 0); });
            listen(input, 'input', ((event: InputEvent) => {
                if (!event.isComposing && !composingInput && !keyboardInputHandled) {
                    if (event.inputType === 'insertText' && event.data) handleInput(event.data);
                    else if (event.inputType === 'deleteContentBackward') handleInput('\x7f');
                    else if (event.inputType === 'deleteContentForward') handleInput('\x1b[3~');
                    else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') handleInput('\r');
                }
                keyboardInputHandled = false;
            }) as EventListener);
        }
        loading.hidden = true;
        source.terminal.focus();
        return {
            dispose,
            escape() {
                if (root.querySelector('.retro-terminal__scrollbar')?.contains(document.activeElement)) {
                    shell?.escape();
                    source?.terminal.focus();
                    return true;
                }
                if (dashboard) { stopDashboard(); return true; }
                return shell?.escape() ?? false;
            }
        };
    } catch (error) {
        dispose();
        throw error;
    }
}

// Classic-script bundle also works under file://; no runtime CDN or React required.
(window as any).R7RetroTerminal = { mount };
