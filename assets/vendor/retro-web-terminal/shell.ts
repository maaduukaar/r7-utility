import type { Terminal, IMarker } from '@xterm/xterm';

export interface Preferences {
    type: 'post' | 'category';
    method: 'translit' | 'translate';
    suffix: string;
}
export interface SlugResult extends Preferences {
    title: string;
    slug: string;
    source: string;
    warning: string;
}
export interface SlugServices {
    preferences(): Preferences;
    configure(next: Partial<Preferences>): Preferences;
    generate(title: string, options: Preferences, signal: AbortSignal, progress: (text: string) => void): Promise<SlugResult>;
    replaceUrl(path: string, slug: string): string;
    docs(): string;
    alphabet(): { ru: string; lat: string }[];
    code(language: string): string;
    links(): { title: string; url: string }[];
    examples(): string[];
    copy(text: string): Promise<void>;
}

const commands: Record<string, string> = {
    slug: 'slug <заголовок> — создать слаг. Можно просто ввести заголовок. Для заголовка, совпадающего с командой, используйте slug help.',
    translit: 'translit <текст> — транслитерация для одного результата. Без текста — переключить метод и пересчитать последний результат.',
    translate: 'translate <текст> — перевод для одного результата: словарь Р7, кэш, затем локальная NMT-модель. Без текста — переключить метод.',
    type: 'type post | category — статья или рубрика. Последний результат пересчитывается. Суффикс используется только в рубриках.',
    method: 'method translit | translate — метод для следующих заголовков и пересчёт последнего результата.',
    suffix: 'suffix <раздел> — суффикс рубрики. suffix clear — убрать. Без аргументов — показать. Пример: suffix Р7 Офис.',
    url: 'url <старый URL или путь> — заменить последний сегмент текущим слагом, сохранив параметры и якорь. Путь запоминается для следующих результатов. url clear — убрать.',
    copy: 'copy — скопировать слаг. copy url — обновлённый URL. copy code [js|php|py] — код. copy letter й — буква. copy link 1 — ссылка.',
    edit: 'edit — вернуть исходный заголовок в строку ввода для правки. edit <номер> — взять результат из history.',
    history: 'history — результаты текущей вкладки. history clear — очистить результаты и историю команд. ↑ / ↓ — предыдущие команды.',
    status: 'status — метод, тип контента, суффикс, URL и последний результат.',
    help: 'help — все команды. help <команда> — подробности. Команды можно вводить с /, например /help.',
    docs: 'docs — справка по алгоритму, стандартам и гибридному переводу из обычного интерфейса.',
    alphabet: 'alphabet — таблица транслитерации. alphabet й — найти букву. copy letter й — скопировать её латинское соответствие.',
    code: 'code js | php | py — исходные примеры кода. В просмотре C копирует весь сниппет. copy code js — скопировать напрямую.',
    links: 'links — первоисточники из справки. copy link <номер> — скопировать адрес.',
    examples: 'examples — примеры заголовков. examples <номер> — сформировать слаг из примера.',
    demo: 'demo — живая диагностика CRT. P / пробел — пауза; 1 / 2 / 3 — график; Esc / Q — обратно к строке ввода.',
    frame: 'frame on | off | toggle — показать или убрать рамку ЭЛТ. Также: show / hide. Без параметра — переключить.',
    clear: 'clear — очистить экран. Результаты и параметры сохраняются. Также Ctrl+L.',
    reset: 'reset — сбросить параметры на «статья / транслитерация», убрать суффикс, URL и текущий результат. История сохраняется.',
    exit: 'exit — вернуться к обычному интерфейсу. Esc на пустой строке работает так же.'
};

// Command/result history stays in this tab; translation uses the page's existing cache.
const memory = {
    commands: [] as string[], results: [] as SlugResult[],
    last: undefined as SlugResult | undefined, path: '', language: 'js'
};
const aliases: Record<string, string> = { '?': 'help', 'справка': 'help', 'cls': 'clear', 'quit': 'exit', 'dashboard': 'demo', 'генератор': 'slug' };
const clean = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ru', { granularity: 'grapheme' }) : undefined;
const chars = (text: string) => segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text);
function cellWidth(text: string): number {
    return chars(text).reduce((sum, ch) => {
        const cp = ch.codePointAt(0)!;
        if (/^\p{Mark}+$/u.test(ch)) return sum;
        return sum + (/\p{Extended_Pictographic}/u.test(ch) || (cp >= 0x1100 && (
            cp <= 0x115f || cp === 0x2329 || cp === 0x232a || (cp >= 0x2e80 && cp <= 0xa4cf) ||
            (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
            (cp >= 0xfe10 && cp <= 0xfe6f) || (cp >= 0xff01 && cp <= 0xff60) || cp >= 0x20000
        )) ? 2 : 1);
    }, 0);
}
function fit(text: string, width: number) {
    let result = '';
    for (const ch of chars(text)) {
        if (cellWidth(result + ch) > width) break;
        result += ch;
    }
    return result;
}
function wrap(text: string, width: number): string[] {
    return clean(text).replace(/\t/g, '    ').split('\n').flatMap(line => {
        if (!line) return [''];
        const lines: string[] = [];
        let row = '', cells = 0;
        for (const ch of chars(line)) {
            const n = cellWidth(ch);
            if (cells + n > width) { lines.push(row); row = ''; cells = 0; }
            row += ch; cells += n;
        }
        lines.push(row);
        return lines;
    });
}

export function createSlugShell(terminal: Terminal, api: SlugServices, signal: AbortSignal, actions: {
    exit(): void;
    demo(): void;
    frame(mode?: string): boolean;
}) {
    let mode: 'prompt' | 'busy' | 'pager' | 'demo' = 'prompt';
    let line = '', cursor = 0, historyIndex = memory.commands.length, draft = '';
    let marker: IMarker | undefined;
    let rendering = false, disposed = false;
    let operation: AbortController | undefined;
    let pager: { title: string; text: string; top: number; copy?: string; note?: string } | undefined;
    let queuedEdit = '';
    let progressVisible = false;
    const active = () => !disposed && !signal.aborted;
    const write = (value: string) => { if (active()) terminal.write(value); };
    const print = (text = '') => write(clean(text).replace(/\n/g, '\r\n') + '\r\n');
    const heading = (text: string) => write('\x1b[1m' + clean(text) + '\x1b[0m\r\n');
    const prefsLine = () => {
        const p = api.preferences();
        return `${p.type === 'post' ? 'Статья' : 'Рубрика'} / ${p.method === 'translit' ? 'транслитерация' : 'перевод'}`;
    };

    function erasePrompt() {
        if (marker && !marker.isDisposed) {
            const buffer = terminal.buffer.active;
            const above = buffer.baseY + buffer.cursorY - marker.line;
            write('\r' + (above > 0 ? `\x1b[${Math.min(above, buffer.cursorY)}A` : '') + '\x1b[J');
        } else write('\r\x1b[2K');
    }
    function renderInput() {
        if (rendering || !active() || mode !== 'prompt') return;
        rendering = true;
        // Read the cursor only after previous writes have been parsed by xterm.
        terminal.write('', () => {
            rendering = false;
            if (!active() || mode !== 'prompt' || !marker) return;
            erasePrompt();
            const points = chars(line);
            const available = Math.max(4, terminal.cols - 6);
            let start = cursor;
            while (start > 0 && cellWidth(points.slice(start - 1, cursor).join('')) < available - 1) start--;
            const left = start ? '‹' : '';
            let visible = fit(points.slice(start).join(''), available - cellWidth(left));
            if (start + chars(visible).length < points.length) visible = fit(visible, available - cellWidth(left) - 1) + '›';
            const offset = 4 + cellWidth(left + points.slice(start, cursor).join(''));
            write('\x1b[1mr7> \x1b[0m' + left + visible + '\r' + `\x1b[${offset}C`);
        });
    }
    function prompt(initial = '') {
        if (!active()) return;
        mode = 'prompt';
        line = initial; cursor = chars(line).length;
        historyIndex = memory.commands.length;
        marker?.dispose(); marker = undefined;
        write('\x1b[?25h');
        terminal.write('', () => {
            if (!active() || mode !== 'prompt') return;
            marker = terminal.registerMarker(0);
            renderInput();
        });
    }
    function showProgress(text: string) {
        if (!active() || mode !== 'busy') return;
        progressVisible = true;
        write('\r\x1b[2K' + fit(clean(text), terminal.cols - 1));
    }
    function endProgress() {
        if (progressVisible) { write('\r\x1b[2K'); progressVisible = false; }
    }
    function openPage(title: string, text: string, copy?: string) {
        mode = 'pager'; pager = { title, text, top: 0, copy };
        write('\x1b[?1049h\x1b[?25l');
        drawPage();
    }
    function drawPage() {
        if (!pager || !active()) return;
        const width = Math.max(8, terminal.cols - 1), height = Math.max(1, terminal.rows - 4);
        const rows = wrap(pager.text, width);
        pager.top = Math.max(0, Math.min(pager.top, Math.max(0, rows.length - height)));
        const title = fit(pager.title, width);
        const footer = terminal.cols < 45 ? '↑↓ Space · Esc назад' : '↑↓ / PgUp / PgDn / Space — листать · Esc / Q — назад';
        write('\x1b[H\x1b[2J\x1b[1m' + title + '\x1b[0m\r\n\r\n' +
            rows.slice(pager.top, pager.top + height).join('\r\n') +
            `\x1b[${terminal.rows - 1};1H\x1b[2m` + fit(`${pager.top + 1}–${Math.min(rows.length, pager.top + height)} / ${rows.length}  ${pager.note || (pager.copy ? 'C — копировать' : '')}`, width) +
            `\x1b[${terminal.rows};1H` + fit(footer, width) + '\x1b[0m');
    }
    function closePage() {
        pager = undefined;
        write('\x1b[?1049l\x1b[?25h');
        prompt();
    }
    function lastResult() {
        if (!memory.last) throw new Error('Сначала введите заголовок и нажмите Enter.');
        return memory.last;
    }
    async function generate(title: string, options = api.preferences()) {
        if (!title.trim()) throw new Error('Введите заголовок: slug Настройка сервера');
        const result = await api.generate(title.trim(), options, operation!.signal, showProgress);
        if (!active() || operation!.signal.aborted) return;
        endProgress();
        memory.last = result;
        memory.results.push(result);
        if (memory.results.length > 100) memory.results.shift();
        print();
        heading(result.slug);
        print(`${result.slug.length} симв. · ${result.source}`);
        if (result.warning) print(result.warning);
        if (memory.path) { print('URL:'); print(api.replaceUrl(memory.path, result.slug)); }
        print('copy — копировать · edit — править');
    }
    async function configure(next: Partial<Preferences>) {
        api.configure(next);
        print(prefsLine());
        if (memory.last) await generate(memory.last.title);
    }
    async function copyTarget(arg: string) {
        const [target = 'slug', ...args] = arg.split(/\s+/).filter(Boolean);
        let text: string;
        if (target === 'slug') text = lastResult().slug;
        else if (target === 'url') {
            if (!memory.path) throw new Error('Сначала задайте путь: url https://example.com/old/');
            text = api.replaceUrl(memory.path, lastResult().slug);
        } else if (target === 'code') text = api.code(args[0] || memory.language);
        else if (target === 'letter') {
            const item = api.alphabet().find(item => item.ru.toLowerCase() === args.join('').toLowerCase());
            if (!item) throw new Error('Укажите букву: copy letter й');
            if (item.lat === '∅') throw new Error('Эта буква опускается: копировать нечего.');
            text = item.lat;
        } else if (target === 'link') {
            const link = api.links()[Number(args[0]) - 1];
            if (!link) throw new Error('Список адресов: links. Копирование: copy link 1');
            text = link.url;
        } else throw new Error(commands.copy);
        await api.copy(text);
        if (active() && !operation?.signal.aborted) print('Скопировано.');
    }
    async function execute(value: string) {
        const match = value.match(/^(\S+)(?:\s+([\s\S]*))?$/)!;
        const first = match[1].replace(/^\//, '').toLowerCase();
        const name = aliases[first] || first;
        let arg = (match[2] || '').trim();
        if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) arg = arg.slice(1, -1);
        switch (name) {
            case 'slug': return generate(arg);
            case 'translit': case 'translate':
                return arg ? generate(arg, { ...api.preferences(), method: name }) : configure({ method: name });
            case 'type':
                if (!arg) return print(prefsLine());
                if (arg !== 'post' && arg !== 'category') throw new Error(commands.type);
                return configure({ type: arg });
            case 'method':
                if (!arg) return print(prefsLine());
                if (arg !== 'translit' && arg !== 'translate') throw new Error(commands.method);
                return configure({ method: arg });
            case 'suffix':
                if (!arg) return print('Суффикс: ' + (api.preferences().suffix || 'не задан'));
                return configure({ suffix: arg === 'clear' ? '' : arg });
            case 'url':
                if (arg === 'clear') { memory.path = ''; return print('Старый URL очищен.'); }
                if (arg) memory.path = arg;
                if (!memory.path) throw new Error(commands.url);
                return print(memory.last ? api.replaceUrl(memory.path, memory.last.slug) : 'Путь сохранён. Теперь введите заголовок.');
            case 'copy': return copyTarget(arg);
            case 'edit': {
                const result = arg ? memory.results[Number(arg) - 1] : lastResult();
                if (!result) throw new Error('Нет такого результата. Список: history');
                api.configure({ type: result.type, method: result.method, suffix: result.suffix });
                const first = result.title.split(/\s/)[0].toLowerCase();
                queuedEdit = commands[first] || aliases[first] || first.startsWith('/') ? 'slug ' + result.title : result.title;
                return;
            }
            case 'history':
                if (arg === 'clear') {
                    memory.commands = []; memory.results = [];
                    return print('История очищена.');
                }
                return openPage('ИСТОРИЯ', memory.results.length ? memory.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.slug}`).join('\n\n') + '\n\nedit <номер> — редактировать.' : 'Результатов пока нет. Введите заголовок.');
            case 'status': {
                const p = api.preferences();
                print(prefsLine());
                print('Суффикс: ' + (p.suffix || 'не задан') + (p.type === 'post' && p.suffix ? ' (только для рубрик)' : ''));
                print('Старый URL: ' + (memory.path || 'не задан'));
                print('Последний слаг: ' + (memory.last?.slug || '—'));
                return;
            }
            case 'help':
                if (arg) {
                    const topic = aliases[arg] || arg;
                    if (!commands[topic]) throw new Error('Неизвестная команда. Полный список: help');
                    return print(commands[topic]);
                }
                return openPage('R7 / КОМАНДЫ',
                    'Введите заголовок и нажмите Enter. Для принудительной генерации: slug <текст>.\n\n' +
                    Object.values(commands).join('\n\n') +
                    '\n\nКЛАВИАТУРА\nTab — дополнить команду; ↑ / ↓ — история.\n← / →, Home / End — курсор.\nCtrl+V или правый клик — вставить из буфера.\nCtrl+U / K — стереть до / после курсора.\nCtrl+W — удалить слово. Ctrl+L — очистить экран.\nCtrl+C — отменить перевод или ввод. Esc — закрыть просмотр / демку, очистить ввод; на пустой строке — выход.\nВставка нескольких строк объединяется в один заголовок и не выполняет команды автоматически.');
            case 'docs': return openPage('СТАНДАРТЫ И ЛОГИКА', api.docs());
            case 'alphabet': {
                const entries = api.alphabet();
                if (arg) {
                    const item = entries.find(item => item.ru.toLowerCase() === arg.toLowerCase());
                    if (!item) throw new Error('Буква не найдена. Полная таблица: alphabet');
                    return print(`${item.ru} → ${item.lat}`);
                }
                return openPage('АЛФАВИТ / CYR-TO-LAT', entries.map(item => `${item.ru}  →  ${item.lat}`).join('\n') + '\n\n∅ — знак опускается.\ncopy letter й — копировать.');
            }
            case 'code': {
                const language = arg || memory.language;
                const code = api.code(language);
                memory.language = language;
                return openPage('КОД / ' + language.toUpperCase(), code, code);
            }
            case 'links': return openPage('ПЕРВОИСТОЧНИКИ', api.links().map((link, i) => `${i + 1}. ${link.title}\n${link.url}`).join('\n\n') + '\n\ncopy link <номер> — копировать адрес.');
            case 'examples':
                if (arg) {
                    const title = api.examples()[Number(arg) - 1];
                    if (!title) throw new Error('Пример не найден. Список: examples');
                    return generate(title);
                }
                return print(api.examples().map((title, i) => `${i + 1}. ${title}`).join('\n') + '\nexamples 1 — сформировать слаг.');
            case 'demo': mode = 'demo'; actions.demo(); return;
            case 'frame':
                if (arg && !['hide', 'show', 'on', 'off', 'вкл', 'выкл', 'включить', 'выключить', 'toggle'].includes(arg)) throw new Error(commands.frame);
                return print(actions.frame(arg) ? 'Рамка показана.' : 'Рамка скрыта.');
            case 'clear': terminal.clear(); write('\x1b[2J\x1b[H'); return;
            case 'reset':
                api.configure({ type: 'post', method: 'translit', suffix: '' });
                memory.path = ''; memory.last = undefined;
                return print('Сброшено. ' + prefsLine());
            case 'exit': actions.exit(); return;
            default:
                if (value.startsWith('/')) throw new Error(`Неизвестная команда: ${first}. Введите help.`);
                return generate(value);
        }
    }
    function submit() {
        const value = line.trim();
        mode = 'busy';
        terminal.write('', () => {
            if (!active()) return;
            erasePrompt(); marker?.dispose(); marker = undefined;
            write('\x1b[1mr7> \x1b[0m'); print(value);
            line = ''; cursor = 0;
            if (!value) { prompt(); return; }
            if (memory.commands.at(-1) !== value) memory.commands.push(value);
            if (memory.commands.length > 100) memory.commands.shift();
            operation = new AbortController();
            const current = operation;
            void execute(value).catch(error => {
                if (!active()) return;
                endProgress();
                print(current.signal.aborted ? 'Отменено.' : 'Ошибка: ' + error.message);
            }).finally(() => {
                if (!active() || operation !== current) return;
                endProgress();
                operation = undefined;
                if (mode === 'busy') { print(); prompt(queuedEdit); queuedEdit = ''; }
            });
        });
    }
    function insert(value: string) {
        const addition = clean(value).replace(/[\n\t]/g, ' ');
        const points = chars(line);
        line = (points.slice(0, cursor).join('') + addition + points.slice(cursor).join('')).slice(0, 8000);
        cursor = Math.min(chars(line).length, cursor + chars(addition).length);
        renderInput();
    }
    function paste(value: string) {
        if (!active() || mode === 'busy' || !value) return false;
        if (mode === 'pager') closePage();
        if (mode !== 'prompt') return false;
        insert(value);
        terminal.focus();
        return true;
    }
    function notice(message: string) {
        if (!active() || mode !== 'prompt') return;
        terminal.write('', () => {
            if (!active() || mode !== 'prompt') return;
            const current = line;
            erasePrompt();
            print(message);
            prompt(current);
        });
    }
    function cancel() {
        if (mode === 'busy') { operation?.abort(); return; }
        line = ''; cursor = 0; renderInput();
    }
    function input(data: string) {
        if (!active()) return;
        if (mode === 'pager') {
            if (data === '\x1b' || data === 'q' || data === '\x03') { closePage(); return; }
            if (data.toLowerCase() === 'c' && pager?.copy) {
                const current = pager;
                void api.copy(current.copy!).then(() => { current.note = 'Скопировано.'; }).catch(error => { current.note = error.message; }).finally(() => { if (pager === current) drawPage(); });
                return;
            }
            if (!pager) return;
            if (data === '\x1b[A') pager.top--;
            else if (data === '\x1b[B' || data === '\r') pager.top++;
            else if (data === ' ' || data === '\x1b[6~') pager.top += Math.max(1, terminal.rows - 5);
            else if (data === '\x1b[5~') pager.top -= Math.max(1, terminal.rows - 5);
            else if (['\x1b[H', '\x1b[1~', '\x1bOH'].includes(data)) pager.top = 0;
            else if (['\x1b[F', '\x1b[4~', '\x1bOF'].includes(data)) pager.top = Number.MAX_SAFE_INTEGER;
            drawPage(); return;
        }
        if (data === '\x03') { cancel(); return; }
        if (mode !== 'prompt') return;
        if (data.startsWith('\x1b[200~')) { insert(data.slice(6).replace(/\x1b\[201~$/, '')); return; }
        const points = chars(line);
        switch (data) {
            case '\r': case '\n': submit(); return;
            case '\x7f': case '\b': if (cursor) { points.splice(--cursor, 1); line = points.join(''); } break;
            case '\x1b[3~': points.splice(cursor, 1); line = points.join(''); break;
            case '\x1b[D': cursor = Math.max(0, cursor - 1); break;
            case '\x1b[C': cursor = Math.min(points.length, cursor + 1); break;
            case '\x01': case '\x1b[H': case '\x1bOH': case '\x1b[1~': cursor = 0; break;
            case '\x05': case '\x1b[F': case '\x1bOF': case '\x1b[4~': cursor = points.length; break;
            case '\x15': line = points.slice(cursor).join(''); cursor = 0; break;
            case '\x0b': line = points.slice(0, cursor).join(''); break;
            case '\x17': {
                const before = points.slice(0, cursor).join('').replace(/\S+\s*$/, '');
                line = before + points.slice(cursor).join(''); cursor = chars(before).length; break;
            }
            case '\x0c': terminal.clear(); write('\x1b[2J\x1b[H'); prompt(line); return;
            case '\x04': if (!line) actions.exit(); return;
            case '\x1b[A': case '\x1b[B': {
                if (historyIndex === memory.commands.length) draft = line;
                historyIndex = Math.max(0, Math.min(memory.commands.length, historyIndex + (data.endsWith('A') ? -1 : 1)));
                line = historyIndex === memory.commands.length ? draft : memory.commands[historyIndex]; cursor = chars(line).length; break;
            }
            case '\t': {
                const prefix = line.replace(/^\//, '');
                if (/\s/.test(prefix)) return;
                const matches = Object.keys(commands).filter(name => name.startsWith(prefix.toLowerCase()));
                if (matches.length === 1) { line = (line.startsWith('/') ? '/' : '') + matches[0] + ' '; cursor = chars(line).length; }
                else if (matches.length > 1) {
                    terminal.write('', () => {
                        if (mode !== 'prompt') return;
                        erasePrompt(); print(matches.join('  ')); prompt(line);
                    }); return;
                }
                break;
            }
            case '\x1b': if (!escape()) actions.exit(); return;
            default: if (!data.startsWith('\x1b')) insert(data); return;
        }
        renderInput();
    }
    function escape() {
        if (mode === 'pager') { closePage(); return true; }
        if (mode === 'busy') { cancel(); return true; }
        if (line) { cancel(); return true; }
        return false;
    }
    function dispose() {
        disposed = true; operation?.abort(); marker?.dispose();
    }
    signal.addEventListener('abort', dispose, { once: true });
    terminal.attachCustomKeyEventHandler(event => {
        if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
            const selected = terminal.getSelection();
            void api.copy(selected).catch(() => {});
            return false;
        }
        return true;
    });
    write('\x1b[?1049l\x1b[?7h\x1b[?2004h\x1b[?25h');
    heading('R7 / SLUG TERMINAL');
    print('Заголовок → Enter. help — команды.');
    print(prefsLine()); print(); prompt();
    return {
        input, paste, notice, escape, dispose,
        resize() { if (mode === 'pager') drawPage(); else if (mode === 'prompt') renderInput(); },
        resume() { write('\x1b[?1049l\x1b[?7h\x1b[?25h'); prompt(); },
        reset() { terminal.clear(); write('\x1b[2J\x1b[H'); prompt(); },
        wheel(delta: number) { if (mode === 'pager' && pager) { pager.top += delta > 0 ? 3 : -3; drawPage(); return true; } return false; }
    };
}
