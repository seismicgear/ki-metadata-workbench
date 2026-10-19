import { FIELDS, POLICY_LABELS, emptyPatch, dirty, changeCount, valueFor, editField, applyPreset, copyStagedPatch, setPolicy, supportsPolicy, setRaw, formatBytes, formatDuration, findings, policyDescription, appearanceWarnings, sharingPolicy, canEdit } from './model.js';
import { CATEGORY_LABELS, classifyTag, metadataFindings, metadataDiff, buildReport, csvReport, bulkPlan, duplicateGroups, fileState, isSavedOutput } from './analysis.js';
import { icon } from './icons.js';
const generalViews = ['presets', 'history', 'tools', 'guide', 'overview', 'compare', 'batch', 'reports'];
const entries = new Map();
let current = null, tab = 'fields', filter = 'all', search = '', busy = false, stop = false;
let presets = [], history = [], diagnostics = null;
let expandedFields = false, neutralNames = false, lastView = '';
let allowUnverified = false, acceptRemux = false, toastTimer;
let session = { read_only: false, locked: false };
let compareLeft = '', compareRight = '', compareChanges = true, overviewFilter = 'all';
let reportNames = false, reportPaths = false, reportValues = false, caseName = '';
let pendingImports = [];
const bridge = window.ki;
function $(id) { const value = document.getElementById(id); if (!value)
    throw Error('Missing element: ' + id); return value; }
function element(tag, className = '', text) { const e = document.createElement(tag); if (className)
    e.className = className; if (text !== undefined)
    e.textContent = text; return e; }
function button(text, name, action, className = 'button') { const b = element('button', className); b.type = 'button'; if (name)
    b.append(icon(name, 16)); if (text)
    b.append(document.createTextNode(text)); if (action)
    b.addEventListener('click', () => { try {
        const result = action();
        if (result instanceof Promise)
            void result.catch(showError);
    }
    catch (e) {
        showError(e);
    } }); return b; }
function title(text, right) { const h = element('div', 'section-title'); h.append(element('span', '', text)); if (right)
    h.append(element('span', 'muted', right)); return h; }
function empty(text, name = 'layers') { const e = element('div', 'empty-state'); e.append(icon(name, 30), element('div', '', text)); return e; }
function showNotice(message) { const n = $('notice'); n.replaceChildren(button('Dismiss', undefined, () => n.hidden = true, 'text-button'), document.createTextNode(message)); n.hidden = false; }
function showError(error) { showNotice(error instanceof Error ? error.message : String(error)); setStatus('Action stopped. Review the message.'); }
function toast(message) { const t = $('toast'); t.textContent = message; t.hidden = false; if (toastTimer)
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000); }
function setStatus(text) { $('global-status').textContent = text; }
function active() { return current ? entries.get(current) : undefined; }
function targets() { const selected = [...entries.values()].filter(e => e.selected); return selected.length ? selected : active() ? [active()] : []; }
function selectionOrWorkspace() { const selected = [...entries.values()].filter(e => e.selected); return selected.length ? selected : [...entries.values()]; }
function requireEdit() { if (session.read_only)
    throw Error('Inspect-only mode is on. Switch to Edit & clean to stage or save metadata changes.'); }
function renderSession() { const b = $('session-mode'); b.replaceChildren(icon(session.read_only ? 'lock' : 'file', 15), document.createTextNode(session.read_only ? 'Inspect only' : 'Edit & clean')); b.classList.toggle('locked', session.read_only); b.setAttribute('aria-pressed', String(session.read_only)); b.title = session.locked ? 'Inspection is locked for this session' : 'Toggle inspect-only mode'; b.disabled = session.locked || busy; $('session-description').textContent = session.read_only ? 'SOURCE WRITES BLOCKED' : 'ORIGINALS RETAINED'; document.body.classList.toggle('inspect-mode', session.read_only); }
async function toggleMode() { if (busy)
    return; session = await bridge.setReadOnly(!session.read_only); if (session.read_only && active() && !generalViews.includes(tab))
    tab = 'evidence'; render(); toast(session.read_only ? 'Inspect-only mode enabled. File edits and restoration are blocked.' : 'Edit & clean enabled. Drafts still require an explicit save.'); }
function announceDirty() { bridge?.setDirty([...entries.values()].some(e => dirty(e.patch))); }
async function work(label, action) { if (busy) {
    toast('An operation is already running.');
    return;
} busy = true; for (const id of ['editor', 'tabs', 'document-header'])
    $(id).inert = true; stop = false; setStatus(label); $('queue-status').textContent = label; $('stop-jobs').hidden = false; renderFooter(); try {
    await action();
    setStatus('Ready');
}
catch (e) {
    showError(e);
}
finally {
    busy = false;
    for (const id of ['editor', 'tabs', 'document-header'])
        $(id).inert = false;
    $('stop-jobs').hidden = true;
    $('queue-status').textContent = `${entries.size} file${entries.size === 1 ? '' : 's'} in workspace.`;
    renderFooter();
    const next = pendingImports.shift();
    if (next)
        void importResult(next);
} }
async function importResult(pick) {
    if (busy) {
        pendingImports.push(pick);
        return;
    }
    if (!pick.paths.length) {
        if (pick.warnings.length)
            showError(pick.warnings.join('\n'));
        return;
    }
    await work('Inspecting local files…', async () => {
        const failures = [...pick.warnings];
        let done = 0;
        for (const path of pick.paths) {
            if (stop)
                break;
            if (entries.has(path))
                continue;
            $('queue-status').textContent = `Inspecting ${++done} / ${pick.paths.length}`;
            try {
                const doc = await bridge.inspect(path);
                entries.set(doc.path, { doc, patch: emptyPatch(), selected: false });
                if (!current) {
                    current = doc.path;
                    tab = session.read_only ? 'evidence' : 'fields';
                }
                render();
            }
            catch (e) {
                failures.push(path.split(/[\\/]/).pop() + ': ' + e.message);
            }
        }
        if (failures.length)
            showError(failures.join('\n'));
        else
            toast('Files inspected. Originals are unchanged.');
    });
}
async function openFiles(folder = false) { if (busy)
    return; await importResult(await bridge.pickFiles(folder)); }
function visibleEntries() { return [...entries.values()].filter(e => (filter === 'all' || e.doc.kind === filter) && e.doc.name.toLowerCase().includes(search.toLowerCase())); }
function renderLibrary() {
    $('file-count').textContent = entries.size + ' FILE' + (entries.size === 1 ? '' : 'S');
    const filters = $('library-filter');
    filters.replaceChildren();
    for (const [key, label] of [['all', 'All'], ['image', 'Images'], ['audio', 'Audio'], ['video', 'Video'], ['document', 'Docs'], ['other', 'Other']])
        filters.append(button(label, undefined, () => { filter = key; renderLibrary(); }, 'chip' + (filter === key ? ' active' : '')));
    const list = $('file-list');
    list.replaceChildren();
    if (!entries.size) {
        list.append(element('div', 'empty-library', 'Your workspace is empty.\nDrop images, audio, video, documents or any other file here.'));
        return;
    }
    for (const entry of visibleEntries()) {
        const row = element('div', 'file-row' + (current === entry.doc.path ? ' active' : ''));
        row.setAttribute('role', 'listitem');
        const check = element('input');
        check.type = 'checkbox';
        check.checked = entry.selected;
        check.setAttribute('aria-label', 'Select ' + entry.doc.name);
        check.addEventListener('click', e => e.stopPropagation());
        check.addEventListener('change', () => { entry.selected = check.checked; render(); });
        const glyph = element('span', 'file-glyph');
        glyph.append(icon(entry.doc.kind, 16));
        const label = element('div', 'file-label');
        label.append(element('span', 'file-name', entry.doc.name), element('span', 'file-meta', `${entry.doc.format} · ${formatBytes(entry.doc.size)}`));
        row.append(check, glyph, label);
        if (dirty(entry.patch))
            row.append(element('span', 'dirty-dot'));
        else if (isSavedOutput(entry))
            row.append(icon('check', 13));
        row.title = entry.doc.path;
        row.tabIndex = 0;
        row.addEventListener('click', () => { current = entry.doc.path; if (generalViews.includes(tab))
            tab = session.read_only ? 'evidence' : 'fields'; render(); });
        row.addEventListener('keydown', e => { if (e.key === 'Enter') {
            current = entry.doc.path;
            tab = session.read_only ? 'evidence' : 'fields';
            render();
        } });
        list.append(row);
    }
    const all = $('select-all');
    const shown = visibleEntries();
    all.checked = shown.length > 0 && shown.every(e => e.selected);
    all.indeterminate = shown.some(e => e.selected) && !all.checked;
}
function renderHeader() {
    const header = $('document-header');
    header.replaceChildren();
    const entry = active();
    const wrapper = element('div');
    const general = generalViews.includes(tab);
    wrapper.append(element('div', 'eyebrow', general ? 'WORKSPACE / ' + tab.toUpperCase() : entry ? `${entry.doc.kind.toUpperCase()} / METADATA EDITOR` : 'YOUR FILES. YOUR METADATA.'));
    const heading = general ? { presets: 'Team presets', history: 'Save history', tools: 'Settings', guide: 'Formats & help', overview: 'Workspace overview', compare: 'Compare files', batch: 'Batch edit', reports: 'Workspace report' }[tab] : entry ? entry.doc.name.replace(/\.[^.]+$/, '') : 'Make every file ready.';
    wrapper.append(element('h1', 'document-title', heading));
    const sub = element('div', 'document-subtitle');
    sub.textContent = general ? { overview: 'Your files, review findings and saved outputs in one inventory.', compare: 'Understand what changed between two files.', batch: 'Preview changes across the selected files before saving.', reports: 'Share a useful record with deliberate control over private details.', presets: 'Reusable metadata templates for the whole team.', history: 'Saved outputs, verification and recoverable originals.', tools: 'Local preferences and the engines included with this utility.', guide: 'What each format supports, and how to get started.' }[tab] ?? '' : entry ? `${entry.doc.format}  ·  ${formatBytes(entry.doc.size)}  ·  ${canEdit(entry.doc) ? 'Metadata editing available' : 'Inspection only'}` : 'The file utility for everyone at Kuykendall Industries.';
    wrapper.append(sub);
    header.append(wrapper);
    if (entry && !general) {
        const right = element('div', 'row document-actions');
        const n = targets().length;
        if (n > 1)
            right.append(element('span', 'tag', n + ' selected'));
        if (targets().some(e => sharingPolicy(e.doc)) && !session.read_only) {
            const prepare = button('Prepare for sharing', 'shield', () => { tab = 'sharing'; render(); }, 'button primary');
            prepare.disabled = busy;
            right.append(prepare);
        }
        header.append(right);
    }
}
function stripImageMetadata() {
    requireEdit();
    const skipped = [], notes = [];
    let count = 0;
    for (const entry of targets()) {
        if (!supportsPolicy(entry.doc, 'strip_metadata')) {
            skipped.push(entry.doc.name + ' — supported images are JPEG, PNG and WebP');
            continue;
        }
        setPolicy(entry.doc, entry.patch, 'strip_metadata');
        count++;
        const warnings = appearanceWarnings(entry.doc);
        if (warnings.length)
            notes.push(entry.doc.name + ': ' + warnings.join(' '));
    }
    announceDirty();
    render();
    toast(`Image metadata removal staged for ${count} file(s). Save to create the cleaned ${count === 1 ? 'copy' : 'copies'}.`);
    if (skipped.length || notes.length)
        showNotice([`Image cleanup staged for ${count} file(s).`, ...(skipped.length ? ['Skipped unsupported files:\n' + skipped.join('\n')] : []), ...(notes.length ? ['Appearance notes:\n' + notes.join('\n')] : [])].join('\n\n'));
}
function renderTabs() {
    const nav = $('tabs');
    nav.replaceChildren();
    const entry = active();
    if (!entry || generalViews.includes(tab)) {
        nav.append(button('Workspace', 'layers', () => { tab = 'overview'; render(); }, 'tab' + (tab === 'overview' ? ' active' : '')), button('Compare', 'compare', () => { tab = 'compare'; render(); }, 'tab' + (tab === 'compare' ? ' active' : '')), button('Reports', 'download', () => { tab = 'reports'; render(); }, 'tab' + (tab === 'reports' ? ' active' : '')));
        return;
    }
    const choices = [['fields', 'Metadata', 'file'], ['evidence', 'Inspect', 'search'], ['sharing', 'Sharing', 'shield'], ['artwork', entry.doc.kind === 'image' ? 'Preview' : 'Artwork', 'image', entry.doc.artwork.length], ['raw', 'Raw tags', 'code', entry.doc.raw.length], ['audit', 'Audit', 'shield']];
    if (['document', 'other'].includes(entry.doc.kind))
        choices.splice(choices.findIndex(c => c[0] === 'artwork'), 1);
    if (entry.doc.kind === 'video')
        choices.push(['streams', 'Streams', 'video']);
    for (const [key, label, name, count] of choices) {
        const b = button(label, name, () => { tab = key; render(); }, 'tab' + (tab === key ? ' active' : ''));
        if (count)
            b.append(element('span', 'tab-count', String(count)));
        nav.append(b);
    }
}
function refreshDraft(entry) { announceDirty(); renderLibrary(); renderChanges(entry); renderVerification(entry); renderFooter(); }
function renderFields(entry, root) {
    if (session.read_only)
        root.append(element('div', 'callout inspection-callout', 'Inspect-only mode is on. Source edits are locked; existing drafts are retained. Use Inspect, Raw tags, Compare and Reports to examine the files.'));
    if (entry.result && !dirty(entry.patch)) {
        const success = element('div', 'save-success');
        success.append(icon('check', 18), element('span', '', entry.result.verification.status === 'matched' ? 'Saved · content check passed' : 'Saved copy · metadata reread'), button('Show file', 'folder', () => bridge.reveal(entry.result.output), 'text-button'));
        root.append(success);
    }
    if (!canEdit(entry.doc)) {
        root.append(title('File inspection'), element('div', 'callout', 'This file can be inspected and its metadata exported. Editing is unavailable for this format or document.'), button('View all tags', 'code', () => { tab = 'raw'; render(); }, 'button primary'), element('p', 'hint', entry.doc.warnings[0] ?? 'Use Formats & help to see editing support.'));
        return;
    }
    const head = title('File details', entry.doc.capabilities.fields.length + ' editable fields');
    root.append(head);
    const actions = element('div', 'row');
    actions.append(button('Apply preset', 'spark', () => { tab = 'presets'; render(); }, 'button small subtle'), button('Save as preset', 'save', () => newPreset(entry), 'button small subtle'));
    if (targets().length > 1)
        actions.append(button('Copy staged edits to selection', 'copy', () => copyPatch(entry), 'button small subtle'));
    root.append(actions, element('p', 'hint', policyDescription(entry.patch.policy, entry.doc.kind)));
    if (entry.patch.policy === 'strip_metadata') {
        root.append(element('div', 'callout', 'Image metadata removal is staged. Tag editing is disabled for this policy so private values cannot be added back. Save a copy to run removal and readback verification.'));
        const warnings = appearanceWarnings(entry.doc);
        if (warnings.length)
            root.append(element('div', 'callout warning', warnings.join(' ')));
    }
    const basic = ['title', 'artist', 'subject', 'album', 'album_artist', 'date', 'genre', 'label', 'company', 'description', 'copyright', 'keywords'];
    for (const group of ['Identity', 'Release', 'Credits', 'Details']) {
        const defs = FIELDS.filter(f => f.group === group && entry.doc.capabilities.fields.includes(f.key) && (expandedFields || basic.includes(f.key))).sort((a, b) => basic.indexOf(a.key) - basic.indexOf(b.key));
        if (!defs.length)
            continue;
        const section = element('section', 'field-group');
        section.append(title(group));
        const grid = element('div', 'fields-grid');
        for (const def of defs) {
            const label = element('label', 'field' + (def.multiline ? ' full' : '') + (Object.hasOwn(entry.patch.fields, def.key) ? ' changed' : ''));
            const text = element('span', 'field-label');
            text.append(document.createTextNode(def.label));
            const mark = element('span', 'modified', Object.hasOwn(entry.patch.fields, def.key) ? 'STAGED' : '');
            text.append(mark);
            const input = def.multiline ? element('textarea', def.key === 'lyrics' ? 'lyrics' : '') : element('input');
            if (input instanceof HTMLInputElement)
                input.type = 'text';
            input.value = valueFor(entry.doc, entry.patch, def.key);
            input.placeholder = def.placeholder ?? 'Not set';
            input.dataset.field = def.key;
            input.maxLength = 1048576;
            input.disabled = session.read_only || entry.patch.policy === 'strip_metadata';
            input.addEventListener('input', () => { editField(entry.doc, entry.patch, def.key, input.value); const changed = Object.hasOwn(entry.patch.fields, def.key); label.classList.toggle('changed', changed); mark.textContent = changed ? 'STAGED' : ''; refreshDraft(entry); });
            label.append(text, input);
            grid.append(label);
        }
        section.append(grid);
        root.append(section);
    }
    if (entry.doc.capabilities.fields.some(k => !basic.includes(k)))
        root.append(button(expandedFields ? 'Show essential fields' : 'Show all ' + entry.doc.capabilities.fields.length + ' editable fields', 'layers', () => { expandedFields = !expandedFields; render(); }, 'button subtle expand-fields'));
    const note = entry.doc.kind === 'document' ? String(entry.doc.properties.cleanup_scope ?? 'Document properties are edited without changing document content.') : entry.doc.properties.adapter === 'exiftool' ? 'Descriptive edits update XMP. All tags shows the wider source inventory.' : entry.doc.kind === 'audio' ? 'Label and publisher are different credits. Unsupported fields are omitted rather than silently redirected. WAV/AIFF use embedded ID3 for full release fields; some players may not display them.' : entry.doc.kind === 'video' ? 'Writable fields apply to container metadata. Review Streams for the media inventory.' : entry.patch.policy === 'strip_metadata' ? 'The saved output is inspected for remaining removable metadata blocks and trailing data. Metadata stored inside image pixels is outside this cleanup.' : entry.doc.format.toUpperCase() === 'WEBP' ? 'WebP supports inspection and Strip image metadata. Descriptive tag editing is unavailable for this format.' : 'Image edits are written to XMP. Existing EXIF/IPTC values are inspect-only and may disagree until a descriptive-clean policy removes them.';
    root.append(element('p', 'hint', note));
}
async function copyPatch(entry) { requireEdit(); const list = targets().filter(e => e !== entry); let applied = 0; const skipped = []; for (const e of list) {
    const unsupported = copyStagedPatch(entry.doc, entry.patch, e.doc, e.patch);
    if (unsupported.length) {
        skipped.push(e.doc.name + ': ' + unsupported.join(', '));
        continue;
    }
    applied++;
} announceDirty(); render(); toast(`Staged edits copied to ${applied} file(s). Raw native fields are never copied across files.`); if (skipped.length)
    showNotice('Skipped incompatible targets:\n' + skipped.join('\n')); }
function renderArtwork(entry, root) {
    if (entry.doc.kind === 'image') {
        root.append(title('Image preview', 'No pixel re-encoding'));
        const card = element('div', 'art-card');
        const image = element('img');
        image.alt = entry.doc.name;
        card.append(image);
        root.append(card);
        void previewUrl(entry).then(url => image.src = url).catch(showError);
        root.append(element('p', 'hint', 'This is the original image. Staged metadata changes do not create a new preview until saved. Strip image metadata removes EXIF orientation and embedded color profiles; encoded image and animation data are kept without recompression.'));
        if (entry.patch.policy === 'strip_metadata') {
            const warnings = appearanceWarnings(entry.doc);
            if (warnings.length)
                root.append(element('div', 'callout warning', warnings.join(' ')));
        }
        return;
    }
    root.append(title('Embedded artwork', entry.doc.artwork.length + ' object(s)'));
    if (entry.doc.capabilities.artwork && !session.read_only) {
        const row = element('div', 'row');
        row.append(button('Replace front cover', 'image', async () => { const path = await bridge.pickArtwork(); if (path) {
            entry.patch.artwork = { action: 'replace', path };
            refreshDraft(entry);
            render();
        } }), button('Remove all artwork', 'trash', () => { entry.patch.artwork = { action: 'remove' }; refreshDraft(entry); render(); }, 'button subtle'));
        root.append(row);
    }
    if (entry.patch.artwork.action !== 'keep')
        root.append(element('p', 'callout warning', entry.patch.artwork.action === 'remove' ? 'Staged: all embedded artwork will be removed.' : 'Staged replacement: ' + entry.patch.artwork.path));
    if (!entry.doc.artwork.length)
        root.append(empty(entry.doc.kind === 'video' ? 'Video attachment editing is not available in this release. Inspect the Streams view.' : 'No embedded artwork was found.', 'image'));
    for (const art of entry.doc.artwork) {
        const card = element('div', 'art-card');
        if (art.data_url) {
            const img = element('img');
            img.src = art.data_url;
            img.alt = art.description || art.kind;
            card.append(img);
        }
        else
            card.append(empty('Preview is unavailable for this object.', 'image'));
        const detail = element('div', 'art-detail');
        detail.append(element('span', '', `${art.kind} · ${art.mime} · ${formatBytes(art.bytes)}`), button('Extract', 'download', async () => { const path = await bridge.exportArtwork(entry.doc.path, art.index); if (path)
            toast('Artwork extracted without re-encoding.'); }, 'button small subtle'));
        card.append(detail);
        root.append(card);
    }
}
function renderRaw(entry, root) {
    root.append(title('Source metadata inventory', 'Edits are staged; this is not an exhaustive byte audit'));
    if (entry.patch.policy === 'strip_metadata')
        root.append(element('div', 'callout', 'Image metadata removal is staged. This inventory still shows source metadata until the cleaned copy is saved.'));
    const controls = element('div', 'raw-controls');
    const search = element('input', 'raw-search');
    search.type = 'search';
    search.placeholder = 'Search keys or values';
    search.setAttribute('aria-label', 'Filter raw tags');
    controls.append(search);
    const namespace = element('select');
    namespace.setAttribute('aria-label', 'Metadata namespace');
    for (const name of ['All namespaces', ...new Set(entry.doc.raw.map(r => r.namespace))]) {
        const o = element('option', '', name);
        o.value = name === 'All namespaces' ? '' : name;
        namespace.append(o);
    }
    controls.append(namespace);
    const category = element('select');
    category.setAttribute('aria-label', 'Metadata category');
    const all = element('option', '', 'All categories');
    all.value = '';
    category.append(all);
    for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
        const o = element('option', '', label);
        o.value = key;
        category.append(o);
    }
    controls.append(category);
    root.append(controls);
    if (!session.read_only && entry.doc.capabilities.raw_edit && entry.patch.policy !== 'strip_metadata')
        root.append(button('Add native field', 'add', () => editRaw(entry), 'button small subtle'));
    const table = element('table');
    const head = element('thead');
    const hr = element('tr');
    for (const label of ['NAMESPACE', 'KEY', 'VALUE', ''])
        hr.append(element('th', '', label));
    head.append(hr);
    table.append(head);
    const body = element('tbody');
    table.append(body);
    const wrap = element('div', 'table-wrap');
    wrap.append(table);
    root.append(wrap);
    let page = 0;
    const pager = element('div', 'pagination');
    root.append(pager);
    const fill = () => { body.replaceChildren(); const rows = entry.doc.raw.filter(r => (r.namespace + ' ' + r.key + ' ' + r.value).toLowerCase().includes(search.value.toLowerCase()) && (!namespace.value || r.namespace === namespace.value) && (!category.value || classifyTag(r) === category.value)); page = Math.min(page, Math.max(0, Math.ceil(rows.length / 150) - 1)); for (const field of rows.slice(page * 150, (page + 1) * 150)) {
        const tr = element('tr');
        tr.append(element('td', 'namespace', field.namespace), element('td', 'raw-key', field.key));
        const cell = element('td', 'value');
        const staged = entry.patch.raw.find(r => r.key === field.key && r.namespace === field.namespace);
        cell.append(element('span', 'raw-value', staged ? (staged.value ?? '[REMOVE]') : field.value));
        if (staged)
            cell.append(element('span', 'tag red', 'STAGED'));
        tr.append(cell);
        const actions = element('td');
        if (!session.read_only && field.writable && entry.patch.policy !== 'strip_metadata')
            actions.append(button('Edit', undefined, () => editRaw(entry, field.namespace, field.key, field.value), 'text-button'));
        else
            actions.append(element('span', 'muted small', 'READ ONLY'));
        tr.append(actions);
        body.append(tr);
    } pager.replaceChildren(element('span', 'hint', rows.length ? `${page * 150 + 1}–${Math.min((page + 1) * 150, rows.length)} of ${rows.length} tags` : 'No matching tags')); const prev = button('Previous', undefined, () => { page--; fill(); }, 'button small subtle'); prev.disabled = page === 0; const next = button('Next', undefined, () => { page++; fill(); }, 'button small subtle'); next.disabled = (page + 1) * 150 >= rows.length; pager.append(prev, next); };
    for (const input of [search, namespace, category])
        input.addEventListener(input === search ? 'input' : 'change', () => { page = 0; fill(); });
    fill();
    const added = entry.patch.raw.filter(r => !entry.doc.raw.some(f => f.key === r.key && f.namespace === r.namespace));
    if (added.length)
        root.append(element('pre', 'code-block', 'ADDITIONAL STAGED FIELDS\n' + JSON.stringify(added, null, 2)));
    root.append(element('p', 'hint', 'Unknown binary/format-specific items may be preserved by a native library without appearing here. Emptying the visible table does not establish that every possible identifier was removed.'));
}
async function editRaw(entry, namespace, key, value) {
    requireEdit();
    const ns = namespace ?? (entry.doc.kind === 'video' ? 'Container' : String(entry.doc.properties.tag_family ?? ''));
    const data = await formDialog(key ? 'Edit native field' : 'Add native field', entry.doc.kind === 'audio' ? 'Use a supported native ItemKey name. Values are text; arbitrary binary frame construction is outside this editor.' : entry.doc.kind === 'image' ? 'Use the editable XMP tag names shown in All tags. Other metadata groups are inspection-only.' : 'Container metadata only. Stream properties and codec parameters are inspect-only.', [
        { key: 'namespace', label: 'Namespace', value: ns, readonly: true }, { key: 'key', label: 'Native key', value: key ?? '', readonly: !!key, choices: !key && Array.isArray(entry.doc.properties.extra_fields) ? entry.doc.properties.extra_fields.map(String) : undefined },
        { key: 'value', label: 'Value (empty removes field)', value: value ?? '', multiline: true }
    ]);
    if (!data)
        return;
    if (!data.key?.trim())
        throw Error('A native key is required.');
    setRaw(entry.doc, entry.patch, { namespace: ns, key: data.key.trim(), value: data.value || null });
    refreshDraft(entry);
    render();
}
function renderAudit(entry, root) {
    root.append(title('Inspection & verification'));
    const controls = element('div', 'row');
    controls.append(button('Export source snapshot', 'download', async () => { if (await bridge.exportJson(entry.doc, entry.doc.name + '.metadata.json'))
        toast('Source metadata snapshot exported.'); }, 'button small subtle'), button('Export staged patch', 'code', async () => { if (await bridge.exportJson(entry.patch, entry.doc.name + '.patch.json'))
        toast('Staged patch exported.'); }, 'button small subtle'));
    if (entry.result)
        controls.append(button('Export save audit', 'shield', async () => { if (await bridge.exportJson(entry.result, entry.doc.name + '.audit.json'))
            toast('Save audit exported.'); }, 'button small subtle'));
    root.append(controls);
    const integrity = element('div', 'audit-card');
    integrity.append(element('h3', '', 'Verification scope'), element('p', '', entry.result ? entry.result.verification.detail : 'Verification runs against the staged output before the file is committed. No media-integrity result is available yet.'));
    if (entry.result) {
        integrity.append(element('p', '', entry.result.verification.method), element('pre', 'code-block', JSON.stringify(entry.result.verification, null, 2)));
    }
    root.append(integrity);
    renderImagePrivacy(entry, root);
    const privacy = element('div', 'audit-card');
    privacy.append(element('h3', '', 'Fields to review'));
    const rows = findings(entry.doc);
    privacy.append(element('p', '', `${rows.length} heuristic finding(s) in the source inventory. Review format-specific metadata checks above for image cleanup results.`));
    for (const f of rows) {
        const row = element('div', 'finding');
        row.append(element('span', '', f.label), element('span', '', f.namespace));
        privacy.append(row);
    }
    root.append(privacy);
    for (const warning of entry.doc.warnings)
        root.append(element('div', 'callout warning', warning));
    const snapshot = element('details');
    snapshot.append(element('summary', '', 'Current source identity / full-file BLAKE3'), element('pre', 'code-block', entry.doc.path + '\n\n' + entry.doc.etag));
    root.append(snapshot);
    const patch = element('details');
    patch.append(element('summary', '', 'Staged patch JSON'), element('pre', 'code-block', JSON.stringify(entry.patch, null, 2)));
    root.append(patch);
}
function renderStreams(entry, root) { root.append(title('Container streams', 'Inspection only')); root.append(element('div', 'callout warning', 'Save uses explicit mapping of every input stream. Unsupported combinations stop the remux; the app does not silently drop audio, subtitles or attachments. Packet verification covers audio/video only.')); for (const field of ['streams', 'chapters']) {
    const d = element('details');
    d.open = true;
    d.append(element('summary', '', field.toUpperCase()), element('pre', 'code-block', JSON.stringify(entry.doc.properties[field] ?? [], null, 2)));
    root.append(d);
} }
async function previewUrl(entry) { return entry.preview ?? (entry.preview = await bridge.preview(entry.doc.path)); }
function renderImagePrivacy(entry, root, compact = false) {
    if (entry.doc.kind !== 'image')
        return;
    const saved = dirty(entry.patch) ? undefined : entry.result;
    const inventory = (saved?.after ?? entry.doc).properties.image_privacy;
    if (!inventory)
        return;
    const clean = inventory.removable_blocks === 0 && inventory.trailing_bytes === 0;
    const box = element('div', compact ? 'image-privacy' : 'audit-card');
    box.append(element('h3', compact ? 'inspector-label' : '', 'Image metadata privacy'));
    const state = entry.patch.policy === 'strip_metadata' ? 'Removal staged — output not checked' : saved ? (clean ? 'Output readback: no removable metadata' : 'Output readback: metadata remains') : (clean ? 'Source: no removable metadata detected' : 'Source metadata detected');
    box.append(element('p', 'metadata-status' + (saved && clean ? ' metadata-clean' : ''), state));
    box.append(element('p', 'hint', `${inventory.removable_blocks} removable block(s) · ${formatBytes(inventory.trailing_bytes)} trailing data`));
    if (inventory.categories.length)
        box.append(element('p', 'hint', inventory.categories.join(' · ')));
    if (saved && clean)
        box.append(element('p', 'hint', 'The saved output was inspected by the native image parser. Encoded media integrity is reported separately.'));
    else if (entry.patch.policy === 'strip_metadata')
        box.append(element('p', 'hint', 'Counts describe the source. Save the cleaned copy to verify that removal completed.'));
    root.append(box);
}
function renderInspector() {
    const root = $('inspector');
    root.replaceChildren();
    const entry = active();
    root.append(element('h2', 'inspector-label', entry ? 'FILE PREVIEW' : 'ON YOUR DEVICE'));
    if (!entry) {
        root.append(element('p', 'hint', 'Open files to inspect their metadata and prepare a copy.'));
        return;
    }
    const card = element('div', 'preview-card');
    root.append(card);
    if (session.read_only && !entry.allowPreview && ['image', 'audio', 'video'].includes(entry.doc.kind)) {
        card.append(icon('lock', 27), element('p', 'preview-fallback', 'Media preview is paused in inspect-only mode.'), button('Load preview', 'image', () => { entry.allowPreview = true; renderInspector(); }, 'button small subtle'));
    }
    else if (entry.doc.kind === 'image') {
        const img = element('img');
        img.alt = entry.doc.name;
        img.addEventListener('error', () => img.replaceWith(element('p', 'preview-fallback', entry.doc.format + ' · Preview unavailable. Metadata is still available.')), { once: true });
        card.append(img);
        void previewUrl(entry).then(url => img.src = url).catch(() => { img.replaceWith(element('p', 'hint', 'Preview unavailable.')); });
    }
    else if (entry.doc.kind === 'audio') {
        const cover = entry.doc.artwork.find(a => a.data_url);
        if (cover) {
            const img = element('img');
            img.src = cover.data_url;
            img.alt = 'Embedded cover';
            card.append(img);
        }
        else {
            const symbol = element('span', 'media-symbol');
            symbol.append(icon('audio', 45));
            card.append(symbol);
        }
        const audio = element('audio');
        audio.controls = true;
        audio.preload = 'none';
        card.append(audio);
        void previewUrl(entry).then(url => audio.src = url).catch(() => audio.remove());
    }
    else if (entry.doc.kind === 'video') {
        const video = element('video');
        video.controls = true;
        video.preload = 'metadata';
        card.append(video);
        void previewUrl(entry).then(url => video.src = url).catch(() => video.replaceWith(element('p', 'hint', 'Preview is unavailable for this codec.')));
    }
    else {
        const symbol = element('div', 'document-symbol');
        symbol.append(icon('file', 42), element('strong', '', entry.doc.format), element('span', '', entry.doc.properties.pages ? String(entry.doc.properties.pages) + ' pages' : 'Document content stays intact'));
        card.append(symbol);
    }
    root.append(element('div', 'preview-caption', ['document', 'other'].includes(entry.doc.kind) ? 'Document content is not rendered here. Use Show in folder to open it in its usual app.' : 'Preview shows the original. Playback depends on its codec.'));
    const props = element('dl', 'property-list');
    const data = [['Format', entry.doc.format], ['File size', formatBytes(entry.doc.size)], ['Access', canEdit(entry.doc) ? 'Edit metadata' : 'Inspect only']];
    if (entry.doc.properties.duration_seconds)
        data.push(['Duration', formatDuration(entry.doc.properties.duration_seconds)]);
    if (entry.doc.properties.pages)
        data.push(['Pages', String(entry.doc.properties.pages)]);
    if (entry.doc.properties.sample_rate)
        data.splice(2, 0, ['Sample rate', String(entry.doc.properties.sample_rate) + ' Hz']);
    if (entry.doc.properties.channels)
        data.splice(3, 0, ['Channels', String(entry.doc.properties.channels)]);
    for (const [k, v] of data)
        props.append(element('dt', '', k), element('dd', '', v));
    root.append(props);
    const verification = element('div', 'inspector-box');
    verification.id = 'verification-panel';
    root.append(verification);
    renderVerification(entry);
    const changes = element('div', 'inspector-box');
    changes.id = 'changes-panel';
    root.append(changes);
    renderChanges(entry);
    root.append(button('Show in folder', 'folder', () => bridge.reveal(entry.doc.path), 'button subtle small full'));
}
function renderVerification(entry) {
    const wrapper = document.getElementById('verification-panel');
    if (!wrapper)
        return;
    wrapper.replaceChildren(element('h3', 'inspector-label', 'SAVE CHECK'));
    const result = dirty(entry.patch) ? undefined : entry.result?.verification;
    const status = result?.status ?? 'pending';
    const badge = element('div', 'verification ' + status);
    const line = element('div', 'verification-title');
    line.append(icon(status === 'matched' ? 'check' : status === 'unverified' ? 'warning' : 'shield', 16), document.createTextNode(status === 'matched' ? 'Last save: content matched' : status === 'metadata_only' ? 'Metadata reread · copy only' : status === 'unverified' ? 'Last save: unverified' : 'Not run yet'));
    badge.append(line, element('p', '', result ? (status === 'matched' ? 'Requested metadata was reread and the protected content check passed.' : result.detail) : dirty(entry.patch) ? 'Checks run when you save this draft.' : 'Your original stays unchanged while you edit.'));
    wrapper.append(badge);
    renderImagePrivacy(entry, wrapper, true);
}
function renderChanges(entry) {
    const panel = document.getElementById('changes-panel');
    if (!panel)
        return;
    panel.replaceChildren(element('h3', 'inspector-label', `STAGED CHANGES / ${changeCount(entry.patch)}`));
    if (!dirty(entry.patch)) {
        panel.append(element('p', 'hint', 'Nothing staged. Your original is unchanged.'));
        return;
    }
    const list = element('ul', 'change-list');
    if (entry.patch.policy !== 'keep') {
        const li = element('li');
        li.append(element('span', 'key', 'POLICY'), element('span', 'new-value', POLICY_LABELS[entry.patch.policy]));
        list.append(li);
    }
    for (const [key, value] of Object.entries(entry.patch.fields)) {
        const li = element('li');
        li.append(element('span', 'key', FIELDS.find(f => f.key === key)?.label ?? key));
        if (entry.doc.fields[key])
            li.append(element('del', '', entry.doc.fields[key]));
        li.append(element('span', 'new-value', value ?? '[Remove field]'));
        list.append(li);
    }
    if (entry.patch.artwork.action !== 'keep') {
        const li = element('li');
        li.append(element('span', 'key', 'ARTWORK'), element('span', 'new-value', entry.patch.artwork.action === 'remove' ? 'Remove all embedded images' : 'Replace front cover'));
        list.append(li);
    }
    for (const raw of entry.patch.raw) {
        const li = element('li');
        li.append(element('span', 'key', raw.namespace + ' / ' + raw.key), element('span', 'new-value', raw.value ?? '[Remove field]'));
        list.append(li);
    }
    panel.append(list);
}
function renderFooter() {
    const root = $('save-bar');
    root.replaceChildren();
    const entry = active();
    renderSession();
    if (session.read_only) {
        const row = element('div', 'row');
        row.append(icon('lock', 15), element('span', 'hint', 'Inspect-only session · source edits and restoration blocked'), button('Create report', 'download', () => { tab = 'reports'; render(); }, 'button small subtle'));
        root.append(row);
        return;
    }
    if (!entry || generalViews.includes(tab)) {
        root.append(element('span', 'hint', 'Original files stay untouched until you explicitly save.'));
        return;
    }
    if (!canEdit(entry.doc) && !targets().some(e => dirty(e.patch))) {
        const row = element('div', 'row');
        row.append(element('span', 'hint', 'Inspection only'), button('Export metadata', 'download', () => bridge.exportJson(entry.doc, entry.doc.name + '.metadata.json'), 'button subtle'));
        root.append(row);
        return;
    }
    const options = element('div', 'save-options');
    const opt = (label, checked, onChange) => { const l = element('label'); const c = element('input'); c.type = 'checkbox'; c.checked = checked; c.addEventListener('change', () => { onChange(c.checked); renderFooter(); }); l.append(c, document.createTextNode(label)); return l; };
    if (targets().some(e => ['audio', 'video'].includes(e.doc.kind)) && diagnostics && !diagnostics.ffmpeg.available)
        options.append(opt('Allow unverified copies', allowUnverified, v => allowUnverified = v));
    if (targets().length > 1)
        options.append(opt('Neutral filenames for batch copies', neutralNames, v => neutralNames = v));
    if (targets().some(e => e.doc.kind === 'video'))
        options.append(opt('I accept video remux limitations', acceptRemux, v => acceptRemux = v));
    root.append(options);
    const actions = element('div', 'save-actions');
    const select = element('select');
    select.setAttribute('aria-label', 'Metadata cleanup policy');
    for (const [key, label] of Object.entries(POLICY_LABELS)) {
        if (!supportsPolicy(entry.doc, key))
            continue;
        const o = element('option', '', label);
        o.value = key;
        o.selected = entry.patch.policy === key;
        select.append(o);
    }
    select.disabled = busy || !entry.doc.capabilities.policies.length;
    select.hidden = !entry.doc.capabilities.policies.length;
    select.addEventListener('change', () => { setPolicy(entry.doc, entry.patch, select.value); announceDirty(); render(); });
    actions.append(select);
    const reset = button('Undo', 'undo', () => { entry.patch = emptyPatch(); announceDirty(); render(); }, 'button subtle small');
    reset.disabled = busy || !dirty(entry.patch);
    actions.append(reset, element('span', 'spacer'));
    const selected = targets();
    const changed = selected.filter(e => dirty(e.patch));
    const replace = button('Replace', 'save', () => saveEntries(true), 'button subtle');
    replace.disabled = busy || entry.doc.properties.copy_only === true || (allowUnverified && changed.some(e => e.doc.kind !== 'image')) || changed.length !== 1;
    const save = button(changed.length > 1 ? `Save ${changed.length} copies` : 'Save copy', 'arrow', () => saveEntries(false), 'button primary');
    save.disabled = busy || !changed.length;
    actions.append(replace, save);
    root.append(actions);
}
async function saveEntries(replace) {
    requireEdit();
    const list = targets().filter(e => dirty(e.patch));
    if (!list.length) {
        toast('Stage a metadata change first.');
        return;
    }
    if (replace && list.length !== 1)
        throw Error('Replace is limited to one file at a time. Use Save copies for batch work.');
    await work('Verifying and saving…', async () => {
        const batchToken = !replace && list.length > 1 ? await bridge.chooseExportFolder({ neutral_names: neutralNames }) : null;
        if (!replace && list.length > 1 && !batchToken)
            return;
        const errors = [];
        let saved = 0;
        for (const entry of list) {
            if (stop)
                break;
            $('queue-status').textContent = 'Saving ' + entry.doc.name;
            try {
                const result = await bridge.save({ path: entry.doc.path, expected_etag: entry.doc.etag, patch: entry.patch, replace_original: replace, allow_unverified: ['audio', 'video'].includes(entry.doc.kind) ? allowUnverified : false, accept_remux: acceptRemux, ...(batchToken ? { batch_token: batchToken } : {}) });
                if (!result) {
                    stop = true;
                    break;
                }
                if (replace) {
                    entries.delete(entry.doc.path);
                    entry.doc = result.after;
                    entry.patch = emptyPatch();
                    entry.result = result;
                    entry.preview = undefined;
                    entries.set(result.after.path, entry);
                    current = result.after.path;
                }
                else {
                    entry.patch = emptyPatch();
                    entry.selected = false;
                    entry.result = result;
                    entries.set(result.after.path, { doc: result.after, patch: emptyPatch(), selected: false, result });
                    current = result.after.path;
                }
                saved++;
                announceDirty();
                render();
                if (result.warnings.length)
                    toast('Saved with notes. Review Audit and History.');
            }
            catch (e) {
                errors.push(entry.doc.name + ': ' + e.message);
            }
        }
        if (batchToken)
            await bridge.releaseExportFolder(batchToken);
        if (saved)
            toast(`${saved} file${saved === 1 ? '' : 's'} saved. ${replace ? 'Verified backup created.' : 'Originals retained.'}`);
        if (errors.length)
            showError(errors.join('\n'));
    });
}
function welcome(root) {
    const w = element('div', 'welcome');
    w.append(element('span', 'eyebrow', 'KUYKENDALL INDUSTRIES / ARRAY / FREE STANDALONE UTILITY'), element('h2', 'display-heading', 'METADATA'), element('h3', 'welcome-title', 'Know what you share.'), element('p', 'welcome-intro', 'Inspect. Edit. Clean. A private workspace for the images, media and documents moving through your ecosystem.'));
    const actions = element('div', 'welcome-actions');
    actions.append(button('Open files', 'add', () => openFiles(), 'button primary'), button('Open a folder', 'folder', () => openFiles(true), 'button subtle'));
    w.append(actions);
    const tasks = element('div', 'task-grid');
    for (const [glyph, heading, copy, action] of [
        ['search', 'Inspect', 'File signatures, fingerprints and metadata.', async () => { await openFiles(); if (active()) {
                tab = 'evidence';
                render();
            } }],
        ['file', 'Edit', 'Titles, credits and properties. One file or a batch.', () => openFiles()],
        ['shield', 'Clean', 'Remove private tags. Verify the output.', async () => { await openFiles(); if (active()) {
                tab = 'sharing';
                render();
            } }],
        ['compare', 'Compare', 'Find differences and export a useful record.', async () => { await openFiles(); tab = 'compare'; render(); }]
    ]) {
        const card = button('', undefined, action, 'task-card');
        card.append(icon(glyph, 23), element('strong', '', heading), element('span', '', copy), icon('arrow', 16));
        tasks.append(card);
    }
    w.append(tasks);
    const foot = element('div', 'welcome-foot');
    foot.append(element('span', '', 'Images · Audio · Video · Documents · Other files'), button('Explore format support', 'arrow', () => { tab = 'guide'; render(); }, 'text-button'));
    w.append(foot);
    root.append(w);
}
function renderSharing(entry, root) {
    root.append(title('Prepare a copy for sharing'), element('p', 'sharing-intro', 'Choose a cleanup, review the draft, then save. Your originals stay in place.'));
    const list = targets();
    const eligible = list.filter(e => sharingPolicy(e.doc));
    const card = element('section', 'sharing-card');
    card.append(icon('shield', 30), element('h2', '', list.length > 1 ? 'Clean ' + eligible.length + ' selected files' : 'Clean this file’s metadata'));
    card.append(element('p', '', entry.doc.kind === 'image' && supportsPolicy(entry.doc, 'strip_metadata') ? 'Remove EXIF, GPS, C2PA and AI generation tags, including Stable Diffusion parameters and ComfyUI workflows.' : String(entry.doc.properties.cleanup_scope ?? policyDescription('privacy', entry.doc.kind))));
    const stage = button('Stage recommended cleanup', 'shield', () => {
        requireEdit();
        const skipped = [], notes = [];
        let count = 0;
        for (const e of list) {
            const policy = sharingPolicy(e.doc);
            if (!policy) {
                skipped.push(e.doc.name);
                continue;
            }
            e.patch = emptyPatch();
            setPolicy(e.doc, e.patch, policy);
            count++;
            if (policy === 'strip_metadata')
                notes.push(...appearanceWarnings(e.doc).map(w => e.doc.name + ': ' + w));
        }
        announceDirty();
        render();
        toast('Cleanup staged for ' + count + ' file(s). Save copies when ready.');
        if (skipped.length || notes.length)
            showNotice([skipped.length ? 'Inspection-only files skipped: ' + skipped.join(', ') : '', ...notes].filter(Boolean).join('\n'));
    }, 'button primary');
    stage.disabled = session.read_only || !eligible.length;
    card.append(stage, element('p', 'hint', session.read_only ? 'Switch to Edit & clean to prepare a copy.' : 'This replaces any staged edits for these files.'));
    root.append(card);
    if (supportsPolicy(entry.doc, 'strip_metadata')) {
        const details = element('details', 'scope-details');
        details.append(element('summary', '', 'Image cleanup details'), element('p', 'hint', policyDescription('strip_metadata', 'image')), button('Strip image metadata', 'shield', stripImageMetadata, 'button small subtle'));
        for (const warning of appearanceWarnings(entry.doc))
            details.append(element('p', 'hint', warning));
        root.append(details);
    }
    const summary = element('div', 'sharing-selection');
    for (const e of list) {
        const row = element('div', 'sharing-row');
        row.append(icon(e.doc.kind, 16), element('span', '', e.doc.name), element('span', 'tag', sharingPolicy(e.doc) ? POLICY_LABELS[sharingPolicy(e.doc)] : 'Inspect only'));
        summary.append(row);
    }
    if (list.length > 1)
        root.append(summary);
    if (dirty(entry.patch))
        root.append(element('div', 'callout staged-callout', 'Cleanup is staged. Use Save copy below to process and check the output.'));
}
function renderGuide(root) {
    root.append(title('One utility. Format-aware tools.'), element('p', 'hint', 'Open any regular file. Editing and cleanup depend on how that format stores its metadata.'));
    const rows = [
        ['Images', 'JPEG, PNG / APNG, WebP', 'Inspect; JPEG/PNG descriptive editing; strict metadata removal for all three families.'],
        ['Photo & camera', 'TIFF, HEIC, HEIF, AVIF, JXL, DNG, NEF, ARW, CR2 / CR3, RAF and more', 'Inspect, edit curated XMP fields and clean known private tags with ExifTool.'],
        ['Design images', 'PSD, PSB, GIF, JP2 / JPX', 'Inspect and edit supported XMP. Formats without a payload fingerprint save copies only.'],
        ['Audio', 'MP3, FLAC, WAV, AIFF, M4A / M4B, OGG / OGA, Opus', 'Edit tags, credits and artwork. Verify compressed audio packets before saving.'],
        ['Video', 'MP4, MOV, M4V, MKV, WebM, AVI, WMV / ASF', 'Edit container tags and clean known private fields. Stream-copy remux; no re-encoding.'],
        ['PDF', 'PDF documents', 'Edit Info properties; clear Info and XMP with a full rewrite. Signed/encrypted files are inspection-only.'],
        ['Office', 'Word, Excel, PowerPoint; document, template and macro variants', 'Edit document properties and clear core, application and custom property parts. Content is checked.'],
        ['OpenDocument', 'ODT, ODS, ODP, ODG, ODF and templates', 'Edit and clear document properties. Content is checked. Signed/encrypted files are inspection-only.'],
        ['Other files', 'Archives, older documents, other media and unknown formats', 'Inspect available tags and export a JSON inventory. Editing is offered only when a writer is available.']
    ];
    const table = element('table', 'format-table');
    const h = element('tr');
    for (const v of ['File family', 'Formats', 'Available operations'])
        h.append(element('th', '', v));
    const head = element('thead');
    head.append(h);
    table.append(head);
    const body = element('tbody');
    for (const row of rows) {
        const tr = element('tr');
        for (const v of row)
            tr.append(element('td', '', v));
        body.append(tr);
    }
    table.append(body);
    root.append(table);
    const quick = element('section', 'quick-guide');
    quick.append(element('h2', '', 'A simple workflow'));
    for (const [n, h, p] of [['01', 'Open', 'Drop files or choose a folder. Select several files for a batch.'], ['02', 'Prepare', 'Edit fields, apply a team preset, or stage the recommended sharing cleanup.'], ['03', 'Save', 'Save copies to one folder. Review the result and reveal the output when done.']]) {
        const row = element('div', 'guide-step');
        row.append(element('span', 'step-number', n), element('strong', '', h), element('p', '', p));
        quick.append(row);
    }
    root.append(quick);
    root.append(element('p', 'hint', 'Ctrl+O opens files · Ctrl+Shift+S saves a copy · Ctrl+K finds an action. Metadata cleanup does not remove details visible in an image, spoken in audio, or written in document content.'));
}
function metricCards(values) { const row = element('div', 'metric-grid'); for (const [value, label, detail] of values) {
    const card = element('div', 'metric-card');
    card.append(element('span', 'eyebrow', label), element('strong', '', value), element('span', 'hint', detail));
    row.append(card);
} return row; }
function tableWithHeaders(labels) { const wrap = element('div', 'table-wrap'); const table = element('table'); const head = element('thead'), row = element('tr'); for (const label of labels)
    row.append(element('th', '', label)); head.append(row); const body = element('tbody'); table.append(head, body); wrap.append(table); return { wrap, body }; }
function checkControl(label, checked, change) { const l = element('label', 'check-setting'); const input = element('input'); input.type = 'checkbox'; input.checked = checked; input.addEventListener('change', () => change(input.checked)); l.append(input, document.createTextNode(label)); return l; }
function showEntry(entry, view = 'fields') { current = entry.doc.path; tab = session.read_only && view === 'fields' ? 'evidence' : view; render(); }
function renderOverview(root) {
    if (!entries.size) {
        welcome(root);
        return;
    }
    const all = [...entries.values()], dupes = duplicateGroups(all), duplicatePaths = new Set(dupes.flatMap(g => g.map(e => e.doc.path)));
    root.append(metricCards([[String(all.length), 'FILES', formatBytes(all.reduce((n, e) => n + e.doc.size, 0)) + ' in workspace'], [String(all.filter(e => metadataFindings(e.doc).length).length), 'REVIEW', 'Files with reviewable metadata'], [String(all.filter(e => dirty(e.patch)).length), 'STAGED', 'Drafts waiting to be saved'], [String(dupes.length), 'DUPLICATE GROUPS', 'Full-file BLAKE3 matches']]));
    const actions = element('div', 'workspace-actions');
    for (const [label, name, view] of [['Compare files', 'compare', 'compare'], ['Batch edit', 'layers', 'batch'], ['Create report', 'download', 'reports']])
        actions.append(button(label, name, () => { tab = view; render(); }, 'button subtle'));
    root.append(actions);
    root.append(title('File inventory', 'Select rows to scope batch edits and reports'));
    const filters = element('div', 'inventory-filters');
    for (const [key, label] of [['all', 'All files'], ['findings', 'Has findings'], ['staged', 'Staged'], ['readonly', 'Inspect only'], ['duplicates', 'Duplicates']])
        filters.append(button(label, undefined, () => { overviewFilter = key; render(); }, 'chip' + (overviewFilter === key ? ' active' : '')));
    root.append(filters);
    const { wrap, body } = tableWithHeaders(['', 'FILE', 'FORMAT / SIZE', 'REVIEW', 'STATUS', '']);
    const visible = all.filter(e => overviewFilter === 'all' || overviewFilter === 'findings' && metadataFindings(e.doc).length || overviewFilter === 'staged' && dirty(e.patch) || overviewFilter === 'readonly' && !canEdit(e.doc) || overviewFilter === 'duplicates' && duplicatePaths.has(e.doc.path));
    for (const e of visible) {
        const row = element('tr');
        const check = element('input');
        check.type = 'checkbox';
        check.checked = e.selected;
        check.setAttribute('aria-label', 'Include ' + e.doc.name);
        check.addEventListener('change', () => { e.selected = check.checked; render(); });
        const cell = element('td');
        cell.append(check);
        const name = element('td', 'inventory-file');
        name.append(button(e.doc.name, e.doc.kind, () => showEntry(e), 'file-open'));
        const detail = element('td');
        detail.append(element('span', '', e.doc.format), element('small', '', formatBytes(e.doc.size)));
        const tags = metadataFindings(e.doc);
        const review = element('td', 'inventory-findings');
        for (const category of [...new Set(tags.map(f => f.category))].slice(0, 3))
            review.append(element('span', 'tag', CATEGORY_LABELS[category]));
        if (!tags.length)
            review.append(element('span', 'muted', 'No flagged tags'));
        if (e.doc.properties.evidence?.extension_status === 'mismatch')
            review.append(element('span', 'tag red', 'Signature mismatch'));
        const status = element('td');
        status.append(element('span', 'status-label ' + (dirty(e.patch) ? 'staged' : ''), fileState(e)));
        const inspect = element('td');
        inspect.append(button('Inspect', 'search', () => showEntry(e, 'evidence'), 'text-button'));
        row.append(cell, name, detail, review, status, inspect);
        body.append(row);
    }
    root.append(wrap);
    if (!visible.length)
        root.append(empty('No files match this filter.', 'search'));
    root.append(element('p', 'hint', `${all.filter(e => e.selected).length} selected · Duplicate groups identify identical file bytes. Different metadata produces a different file fingerprint.`));
}
function renderEvidence(entry, root) {
    const doc = entry.doc, evidence = doc.properties.evidence, rows = metadataFindings(doc);
    root.append(title('File identity & review', 'Read-only analysis'));
    root.append(metricCards([[doc.format, 'FORMAT', evidence?.detected_type ?? 'Signature not identified'], [formatBytes(doc.size), 'FILE SIZE', String(evidence?.bytes_hashed ?? doc.size) + ' bytes'], [String(doc.raw.length), 'TAGS', 'Source metadata inventory'], [String(rows.length), 'REVIEW ITEMS', 'Heuristic category matches']]));
    if (evidence?.extension_status === 'mismatch')
        root.append(element('div', 'callout warning', 'File extension and signature disagree. Editing is disabled. Review the actual file type before using it in another application.'));
    const identity = element('section', 'evidence-card');
    identity.append(element('h2', '', 'Fingerprints'));
    for (const [label, value] of [['SHA-256', evidence?.sha256 ?? 'Unavailable in this inspection'], ['BLAKE3', doc.etag]]) {
        const field = element('label', 'hash-field');
        field.append(element('span', 'eyebrow', label));
        const input = element('input', 'hash-value');
        input.value = value;
        input.readOnly = true;
        input.setAttribute('aria-label', label + ' fingerprint');
        input.addEventListener('focus', () => input.select());
        field.append(input);
        identity.append(field);
    }
    identity.append(element('p', 'hint', 'Each fingerprint covers every byte in the file. Select a value to copy it. Metadata edits change these fingerprints; media-preservation checks are reported separately after saving.'));
    root.append(identity);
    if (evidence) {
        const signature = element('section', 'evidence-card');
        signature.append(element('h2', '', 'File signature'));
        const dl = element('dl', 'evidence-properties');
        for (const [key, value] of [['Detected container', evidence.detected_type ?? 'Unrecognized'], ['MIME family', evidence.mime_type ?? 'Unknown'], ['Extension check', evidence.extension_status === 'compatible' ? 'Compatible with container' : evidence.extension_status === 'mismatch' ? 'Mismatch' : 'Not determined']])
            dl.append(element('dt', '', key), element('dd', '', value));
        signature.append(dl, element('div', 'eyebrow', 'FIRST 32 BYTES'), element('pre', 'code-block header-bytes', evidence.header_hex || '[empty file]'));
        root.append(signature);
    }
    const findingsCard = element('section', 'evidence-card');
    findingsCard.append(element('h2', '', 'Metadata to review'), element('p', 'hint', 'Categories help locate sensitive fields. Content Credentials are detected by presence; their signatures are not authenticated here.'));
    if (!rows.length)
        findingsCard.append(element('p', 'muted', 'No flagged tags in the available inventory.'));
    for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
        const list = rows.filter(r => r.category === category);
        if (!list.length)
            continue;
        const group = element('details', 'finding-group');
        group.open = ['location', 'generation', 'provenance'].includes(category);
        group.append(element('summary', '', `${label} · ${list.length}`));
        for (const row of list.slice(0, 100)) {
            const item = element('div', 'finding');
            item.append(element('span', '', row.key), element('span', 'muted', row.namespace));
            group.append(item);
        }
        if (list.length > 100)
            group.append(element('p', 'hint', `${list.length - 100} more. Use Raw tags to filter the complete inventory.`));
        findingsCard.append(group);
    }
    root.append(findingsCard);
    const actions = element('div', 'row');
    actions.append(button('View all tags', 'code', () => { tab = 'raw'; render(); }, 'button subtle'), button('Compare with another file', 'compare', () => { compareLeft = doc.path; compareRight = ''; tab = 'compare'; render(); }, 'button subtle'), button('Refresh inspection', 'refresh', async () => { if (dirty(entry.patch) && !await confirmDialog('Reload this file?', 'Reloading discards its staged edits. Files on disk stay unchanged.'))
        return; await work('Refreshing file identity…', async () => { entry.doc = await bridge.inspect(doc.path); entry.patch = emptyPatch(); entry.preview = undefined; announceDirty(); render(); }); }, 'button subtle'));
    root.append(actions);
    for (const warning of doc.warnings)
        root.append(element('div', 'callout warning', warning));
    root.append(element('p', 'hint', evidence?.scope ?? 'Inspection reports available metadata. It does not establish file authenticity or the absence of private data.'));
}
function renderCompare(root) {
    const list = [...entries.values()];
    if (list.length < 2) {
        root.append(empty('Open at least two files to compare their metadata.', 'compare'), button('Open files', 'add', () => openFiles(), 'button primary'));
        return;
    }
    if (!entries.has(compareLeft))
        compareLeft = (list.find(e => e.selected) ?? list[0]).doc.path;
    if (!entries.has(compareRight) || compareRight === compareLeft)
        compareRight = (list.find(e => e.selected && e.doc.path !== compareLeft) ?? list.find(e => e.doc.path !== compareLeft)).doc.path;
    const controls = element('div', 'compare-controls');
    for (const side of ['left', 'right']) {
        const label = element('label', 'field');
        label.append(element('span', 'field-label', side === 'left' ? 'Before / reference' : 'After / comparison'));
        const select = element('select');
        select.setAttribute('aria-label', side === 'left' ? 'Reference file' : 'Comparison file');
        for (const e of list) {
            const o = element('option', '', e.doc.name);
            o.value = e.doc.path;
            o.selected = e.doc.path === (side === 'left' ? compareLeft : compareRight);
            select.append(o);
        }
        select.addEventListener('change', () => { if (side === 'left')
            compareLeft = select.value;
        else {
            if (select.value === compareLeft) {
                toast('Choose two different files.');
                select.value = compareRight;
                return;
            }
            compareRight = select.value;
        } render(); });
        label.append(select);
        controls.append(label);
    }
    controls.append(button('Swap', 'compare', () => { [compareLeft, compareRight] = [compareRight, compareLeft]; render(); }, 'button subtle'));
    root.append(controls);
    const left = entries.get(compareLeft), right = entries.get(compareRight), rows = metadataDiff(left.doc, right.doc), changed = rows.filter(r => r.status !== 'unchanged');
    root.append(metricCards([[String(changed.filter(r => r.status === 'added').length), 'ADDED', 'Keys only in comparison'], [String(changed.filter(r => r.status === 'removed').length), 'REMOVED', 'Keys only in reference'], [String(changed.filter(r => r.status === 'changed').length), 'CHANGED', 'Values differ'], [left.doc.etag === right.doc.etag ? 'SAME' : 'DIFFERENT', 'FILE BYTES', 'Full-file BLAKE3 comparison']]));
    root.append(checkControl('Show changes only', compareChanges, v => { compareChanges = v; render(); }));
    const { wrap, body } = tableWithHeaders(['NAMESPACE / KEY', 'REFERENCE', 'COMPARISON', 'CHANGE']);
    wrap.classList.add('compare-table');
    const filtered = compareChanges ? changed : rows;
    let limit = 200;
    const more = button('Show 200 more rows', 'add', () => { limit += 200; fill(); }, 'button subtle small');
    const fill = () => { body.replaceChildren(); for (const row of filtered.slice(0, limit)) {
        const tr = element('tr', 'diff-' + row.status);
        const key = element('td');
        key.append(element('span', 'namespace', row.namespace), element('strong', 'raw-key', row.key));
        const before = element('td', 'diff-value'), after = element('td', 'diff-value');
        before.textContent = row.before.length ? row.before.join('\n\n') : '—';
        after.textContent = row.after.length ? row.after.join('\n\n') : '—';
        tr.append(key, before, after, element('td', 'diff-status', row.status));
        body.append(tr);
    } more.hidden = filtered.length <= limit; };
    fill();
    root.append(wrap, more);
    if (!filtered.length)
        root.append(empty(compareChanges ? 'No differences in the available raw metadata.' : 'No raw metadata was found in these files.', 'check'));
    root.append(element('p', 'hint', 'Comparison uses the last inspected source inventory, not unsaved drafts. Repeated values are compared as a set with duplicate counts retained. Matching metadata does not establish that media content matches.'));
}
function renderBatch(root) {
    const list = selectionOrWorkspace();
    root.append(title('One change, many files', list.length + ' file(s) in scope'), element('p', 'hint', 'Select files in the sidebar or Overview to narrow the scope. With no selection, the whole workspace is included. Preview every value before staging; saving happens separately.'));
    if (!list.length) {
        root.append(empty('Open files to prepare a batch edit.', 'layers'));
        return;
    }
    if (session.read_only) {
        root.append(element('div', 'callout inspection-callout', 'Inspect-only mode is on. Switch to Edit & clean to use batch editing.'));
        return;
    }
    const panel = element('div', 'batch-form');
    const fields = element('select');
    fields.setAttribute('aria-label', 'Batch field');
    const available = FIELDS.filter(f => list.some(e => e.doc.capabilities.fields.includes(f.key)));
    for (const f of available) {
        const o = element('option', '', f.label);
        o.value = f.key;
        fields.append(o);
    }
    if (!available.length) {
        root.append(empty('These files have no common supported metadata editor.', 'lock'));
        return;
    }
    const operation = element('select');
    operation.setAttribute('aria-label', 'Batch operation');
    for (const [key, label] of [['set', 'Set value'], ['replace', 'Find & replace text'], ['remove', 'Remove field']]) {
        const o = element('option', '', label);
        o.value = key;
        operation.append(o);
    }
    const find = element('input');
    find.placeholder = 'Text to find';
    find.setAttribute('aria-label', 'Find text');
    find.maxLength = 1000;
    find.hidden = true;
    const value = element('textarea');
    value.placeholder = 'New value';
    value.setAttribute('aria-label', 'Batch value');
    value.maxLength = 1048576;
    panel.append(fields, operation, find, value);
    let caseSensitive = true;
    const match = checkControl('Case-sensitive match', true, v => { caseSensitive = v; invalidate(); });
    match.hidden = true;
    panel.append(match);
    root.append(panel);
    const preview = element('div', 'batch-preview');
    const actions = element('div', 'row');
    let planned = [], oldPatches = null;
    const stage = button('Stage changes', 'check', () => { requireEdit(); oldPatches = new Map(); let count = 0; for (const row of planned) {
        if (!row.changed)
            continue;
        const entry = entries.get(row.path);
        if (!entry)
            continue;
        oldPatches.set(row.path, structuredClone(entry.patch));
        editField(entry.doc, entry.patch, fields.value, row.after);
        entry.selected = true;
        count++;
    } stage.disabled = true; undo.disabled = false; saveBatch.disabled = false; announceDirty(); renderLibrary(); renderFooter(); preview.prepend(element('div', 'save-success', `${count} file(s) staged. Open a file to review the draft or save the selected copies.`)); }, 'button primary');
    stage.disabled = true;
    const undo = button('Undo this batch', 'undo', () => { requireEdit(); if (!oldPatches)
        return; for (const [path, patch] of oldPatches) {
        const e = entries.get(path);
        if (e)
            e.patch = patch;
    } oldPatches = null; announceDirty(); renderLibrary(); renderFooter(); undo.disabled = true; stage.disabled = true; saveBatch.disabled = true; preview.replaceChildren(element('p', 'hint', 'Batch draft changes undone.')); }, 'button subtle');
    undo.disabled = true;
    const invalidate = () => { planned = []; stage.disabled = true; preview.replaceChildren(); };
    operation.addEventListener('change', () => { find.hidden = match.hidden = operation.value !== 'replace'; value.hidden = operation.value === 'remove'; invalidate(); });
    for (const input of [fields, find, value])
        input.addEventListener(input === fields ? 'change' : 'input', invalidate);
    const review = button('Preview changes', 'search', () => { planned = bulkPlan(list, { field: fields.value, operation: operation.value, find: find.value, value: value.value, caseSensitive }); preview.replaceChildren(); const changes = planned.filter(r => r.changed), skipped = planned.filter(r => !r.compatible); preview.append(title(`${changes.length} change(s) · ${skipped.length} skipped`)); const table = tableWithHeaders(['FILE', 'CURRENT DRAFT', 'PROPOSED VALUE', 'RESULT']); for (const row of planned) {
        const tr = element('tr');
        tr.append(element('td', '', row.name), element('td', 'diff-value', row.before || '—'), element('td', 'diff-value', row.compatible ? (row.after || '[Remove field]') : '—'), element('td', '', row.reason || (!row.changed ? 'Unchanged' : 'Will stage')));
        table.body.append(tr);
    } preview.append(table.wrap); stage.disabled = !changes.length; }, 'button subtle');
    const saveBatch = button('Save staged copies', 'save', () => saveEntries(false), 'button primary');
    saveBatch.disabled = true;
    actions.append(review, stage, undo, saveBatch);
    root.append(actions, preview);
}
function renderReports(root) {
    const list = selectionOrWorkspace();
    root.append(title('A portable record of this workspace', list.length + ' file(s) in scope'), element('p', 'hint', 'Export a structured JSON report for investigations or a CSV inventory for a team spreadsheet. Reports describe the last inspection and recorded saves; they do not process the source files.'));
    if (!list.length) {
        root.append(empty('Open files before creating a report.', 'download'));
        return;
    }
    const panel = element('section', 'report-options');
    const label = element('label', 'field');
    label.append(element('span', 'field-label', 'Case / project name (optional)'));
    const name = element('input');
    name.placeholder = 'For example, October asset review';
    name.value = caseName;
    name.maxLength = 200;
    name.addEventListener('input', () => caseName = name.value);
    label.append(name);
    panel.append(label);
    const disclosure = element('p', 'report-disclosure');
    const update = () => { disclosure.textContent = reportValues ? 'The report will contain source metadata values, which can include names, GPS, prompts and embedded paths.' : reportNames || reportPaths ? 'Tag values are omitted. The report includes the file names or paths you selected.' : 'Names, paths and tag values are omitted. Files receive report IDs; fingerprints, counts and verification status are included.'; disclosure.classList.toggle('warning', reportValues || reportPaths); };
    panel.append(checkControl('Include original filenames', reportNames, v => { reportNames = v; update(); }), checkControl('Include full file paths', reportPaths, v => { reportPaths = v; update(); }), checkControl('Include source tag values', reportValues, v => { reportValues = v; update(); }), disclosure);
    update();
    root.append(panel);
    const exportReport = async (format) => { const report = buildReport(list, { caseName, includeNames: reportNames, includePaths: reportPaths, includeValues: reportValues }); if (await bridge.exportReport(format === 'csv' ? csvReport(report) : report, format, 'KI-Metadata-Report.' + format))
        toast(format.toUpperCase() + ' report exported.'); };
    const actions = element('div', 'row');
    actions.append(button('Export JSON report', 'code', () => exportReport('json'), 'button primary'), button('Export CSV report', 'download', () => exportReport('csv'), 'button subtle'));
    root.append(actions);
    root.append(metricCards([[String(list.length), 'FILES', 'Selected files or whole workspace'], [String(list.filter(e => metadataFindings(e.doc).length).length), 'REVIEW', 'Files with flagged tags'], [String(list.filter(e => isSavedOutput(e)).length), 'SAVED OUTPUTS', 'With recorded save checks'], [String(duplicateGroups(list).length), 'DUPLICATE GROUPS', 'Byte-identical files']]));
    root.append(element('p', 'hint', 'Use selected rows to export a subset. CSV cells are escaped for spreadsheet use. Report timestamps describe when the report was created, not an independently certified chain of custody.'));
}
async function loadPresets() { presets = await bridge.presets(); }
function renderPresets(root) {
    root.append(title('Consistent details across the team'));
    root.append(element('p', 'hint', 'Save a reusable template, export a preset pack, and give the same pack to everyone who needs it. Imports add templates to this device.'));
    const actions = element('div', 'row preset-actions');
    actions.append(button('Import team presets', 'folder', async () => { const result = await bridge.importPresets(); if (result) {
        presets = result;
        render();
        toast('Team presets imported.');
    } }, 'button primary'), button('Export custom presets', 'download', async () => { if (await bridge.exportPresets())
        toast('Preset pack exported.'); }, 'button subtle'));
    root.append(actions);
    if (active())
        root.append(button('Create from current editor', 'add', () => newPreset(active()), 'button small subtle'));
    for (const preset of presets) {
        const card = element('div', 'preset-item');
        card.append(element('h3', '', preset.name));
        const detail = element('div', 'preset-tags');
        detail.append(element('div', '', POLICY_LABELS[preset.policy]));
        if (preset.policy === 'strip_metadata')
            detail.append(element('div', '', 'JPEG, PNG and WebP only. Clears staged edits and prevents added tags.'));
        for (const [k, v] of Object.entries(preset.fields))
            detail.append(element('div', '', `${FIELDS.find(f => f.key === k)?.label ?? k}: ${v}`));
        card.append(detail);
        const row = element('div', 'row');
        const apply = button('Apply to ' + (targets().length > 1 ? targets().length + ' selected files' : 'current file'), 'spark', () => { requireEdit(); const skipped = [], notes = []; let applied = 0; for (const e of targets()) {
            const compatible = supportsPolicy(e.doc, preset.policy);
            const keys = applyPreset(e.doc, e.patch, preset);
            if (keys.length)
                skipped.push(e.doc.name + ': ' + keys.join(', '));
            if (compatible)
                applied++;
            if (compatible && preset.policy === 'strip_metadata') {
                const warnings = appearanceWarnings(e.doc);
                if (warnings.length)
                    notes.push(e.doc.name + ': ' + warnings.join(' '));
            }
        } announceDirty(); tab = 'fields'; render(); toast(`Preset staged for ${applied} file(s). Save to commit it.`); if (skipped.length || notes.length)
            showNotice([...(skipped.length ? ['Skipped incompatible files or fields:\n' + skipped.join('\n')] : []), ...(notes.length ? ['Appearance notes:\n' + notes.join('\n')] : [])].join('\n\n')); }, 'button small primary');
        apply.disabled = session.read_only || !active();
        row.append(apply);
        if (!preset.builtin)
            row.append(button('Delete', 'trash', async () => { if (await confirmDialog('Delete preset?', 'This removes the template, not metadata in any file.')) {
                presets = await bridge.deletePreset(preset.id);
                render();
            } }, 'button small subtle'));
        else
            row.append(element('span', 'tag', 'KI BUILT-IN'));
        card.append(row);
        root.append(card);
    }
}
async function newPreset(entry) {
    const values = entry.doc.capabilities.fields.map(key => ({ key, value: valueFor(entry.doc, entry.patch, key) })).filter(v => v.value);
    const choices = values.map(({ key, value }) => ({ key: 'include_' + key, label: (FIELDS.find(f => f.key === key)?.label ?? key) + ' — ' + value.slice(0, 120), value: 'true', checked: Object.hasOwn(entry.patch.fields, key) }));
    const data = await formDialog('Create metadata preset', 'Choose the values to reuse across files. Only checked fields will be included; the current cleanup policy is included too.', [{ key: 'name', label: 'Preset name', value: '' }, ...choices]);
    if (!data)
        return;
    const fields = {};
    for (const { key, value } of values)
        if (data['include_' + key] === 'true')
            fields[key] = value;
    if (!Object.keys(fields).length && entry.patch.policy === 'keep')
        throw Error('Choose at least one field for this preset.');
    presets = await bridge.savePreset({ id: crypto.randomUUID?.() ?? ('preset-' + Date.now().toString(36)), name: data.name ?? '', fields, policy: entry.patch.policy });
    tab = 'presets';
    render();
    toast('Preset saved locally.');
}
async function showHistory() { await work('Reading local history…', async () => { history = await bridge.history(); tab = 'history'; render(); }); }
function renderHistory(root) {
    root.append(title('Recent saves & recoverable originals', 'Latest 50 journals, up to 8 MiB'));
    root.append(element('div', 'callout warning', 'Audit JSON and backups can contain the metadata you removed. They remain local, but do not share them as sanitized files. Save Copy leaves originals in place. Restore is available for replaced originals only.'));
    if (!history.length) {
        root.append(empty('No save journals yet. Completed native writes appear here.', 'history'));
        return;
    }
    for (const row of history) {
        const item = element('div', 'history-item');
        item.append(element('h3', '', row.after.name), element('p', 'hint', row.saved_at_ms ? new Date(row.saved_at_ms).toLocaleString() : ''), element('span', 'tag', row.verification.status === 'matched' ? 'CONTENT MATCHED' : row.verification.status === 'metadata_only' ? 'METADATA REREAD' : 'UNVERIFIED'), element('p', '', row.output), element('p', '', row.verification.detail));
        const actions = element('div', 'row');
        actions.append(button('Reveal output', 'folder', () => bridge.reveal(row.output), 'button small subtle'), button('Export audit', 'download', () => bridge.exportJson(row, row.after.name + '.audit.json'), 'button small subtle'));
        if (row.backup && row.journal)
            actions.append(button('Restore original', 'undo', async () => { await work('Restoring verified backup…', async () => { const doc = await bridge.restore(row.journal); if (doc) {
                entries.set(doc.path, { doc, patch: emptyPatch(), selected: false });
                current = doc.path;
                history = await bridge.history();
                render();
                toast('Original restored. Prior edited version was backed up.');
            } }); }, 'button small subtle'));
        item.append(actions);
        root.append(item);
    }
}
async function showTools() { tab = 'tools'; render(); await work('Checking local tools…', async () => { diagnostics = await bridge.doctor(); render(); }); }
function renderTools(root) {
    renderDisplaySettings(root);
    root.append(title('Included engines'), element('p', 'hint', 'The portable utility includes the engines needed for supported formats. You can choose another trusted installation when needed.'));
    const core = element('div', 'tools-card');
    core.append(element('h3', '', 'Rust engine'), element('p', diagnostics ? 'good' : 'bad', diagnostics ? 'Engine available · ' + diagnostics.version : 'Not verified in this session. Build the native engine and refresh.'), button('Refresh checks', 'shield', showTools, 'button small subtle'));
    root.append(core);
    for (const name of ['exiftool', 'ffmpeg', 'ffprobe']) {
        const tool = diagnostics?.[name];
        const card = element('div', 'tools-card');
        card.append(element('h3', '', name.toUpperCase()), element('p', tool?.available ? 'good' : 'bad', tool?.available ? tool.version : tool?.error ?? 'Not checked'), button('Choose executable', 'folder', async () => { const d = await bridge.chooseTool(name); if (d) {
            diagnostics = d;
            render();
        } }, 'button small subtle'));
        root.append(card);
    }
    if (diagnostics)
        root.append(element('p', 'hint', 'Local configuration and history: ' + diagnostics.data_dir));
    root.append(element('p', 'hint', 'Choose only a trusted FFmpeg/ffprobe executable. The app invokes the selected program directly, without a shell. Engines run locally. No download happens inside the app.'));
}
function formDialog(heading, message, fields, submit = 'Save') {
    const dialog = $('dialog');
    dialog.classList.remove('command-dialog');
    const root = $('dialog-content');
    root.replaceChildren();
    root.append(element('h2', '', heading), element('p', '', message));
    const form = element('form');
    const controls = new Map();
    for (const f of fields) {
        const label = element('label', 'field');
        label.append(element('span', 'field-label', f.label));
        let input;
        if (f.checked !== undefined) {
            const check = element('input');
            check.type = 'checkbox';
            check.checked = f.checked;
            input = check;
            label.classList.add('preset-field-option');
        }
        else if (f.choices?.length) {
            const select = element('select');
            for (const text of f.choices) {
                const o = element('option', '', text);
                o.value = text;
                select.append(o);
            }
            input = select;
            input.value = f.value || f.choices[0];
        }
        else {
            input = f.multiline ? element('textarea') : element('input');
            input.value = f.value;
            input.readOnly = !!f.readonly;
        }
        input.name = f.key;
        label.append(input);
        form.append(label);
        controls.set(f.key, input);
    }
    const buttons = element('div', 'dialog-buttons');
    const cancel = button('Cancel', undefined, () => dialog.close('cancel'), 'button subtle');
    const ok = button(submit, undefined, undefined, 'button primary');
    ok.type = 'submit';
    buttons.append(cancel, ok);
    form.append(buttons);
    root.append(form);
    return new Promise(resolve => { let result = null; const close = () => { dialog.removeEventListener('close', close); resolve(result); }; dialog.addEventListener('close', close); form.addEventListener('submit', e => { e.preventDefault(); result = Object.fromEntries([...controls].map(([k, c]) => [k, c instanceof HTMLInputElement && c.type === 'checkbox' ? String(c.checked) : c.value])); dialog.close('ok'); }); dialog.showModal(); setTimeout(() => [...controls.values()].find(c => !(c instanceof HTMLInputElement && c.readOnly))?.focus(), 0); });
}
async function confirmDialog(title, message) { return (await formDialog(title, message, [], 'Continue')) !== null; }
let preferences = { density: 'comfortable', reduceMotion: false };
function applyPreferences() {
    try {
        const p = JSON.parse(localStorage.getItem('ki-metadata-display') ?? 'null');
        if (p && ['comfortable', 'compact'].includes(p.density))
            preferences = { density: p.density, reduceMotion: p.reduceMotion === true };
    }
    catch { }
    document.documentElement.dataset.density = preferences.density;
    document.documentElement.classList.toggle('reduce-motion', preferences.reduceMotion);
}
function savePreferences() { try {
    localStorage.setItem('ki-metadata-display', JSON.stringify(preferences));
}
catch { } document.documentElement.dataset.density = preferences.density; document.documentElement.classList.toggle('reduce-motion', preferences.reduceMotion); }
function renderDisplaySettings(root) {
    root.append(title('Make it comfortable'));
    const card = element('div', 'settings-display');
    const label = element('label', 'field');
    label.append(element('span', 'field-label', 'Interface density'));
    const select = element('select');
    select.setAttribute('aria-label', 'Interface density');
    for (const [value, text] of [['comfortable', 'Comfortable · larger controls'], ['compact', 'Compact · more on screen']]) {
        const o = element('option', '', text);
        o.value = value;
        o.selected = preferences.density === value;
        select.append(o);
    }
    select.addEventListener('change', () => { preferences.density = select.value; savePreferences(); });
    label.append(select);
    card.append(label);
    const motion = element('label', 'check-setting');
    const check = element('input');
    check.type = 'checkbox';
    check.checked = preferences.reduceMotion;
    check.addEventListener('change', () => { preferences.reduceMotion = check.checked; savePreferences(); });
    motion.append(check, document.createTextNode('Reduce background motion'));
    card.append(motion, element('p', 'hint', 'Display preferences are saved on this device. System reduced-motion settings are also respected.'));
    root.append(card);
}
function showCommands() {
    const dialog = $('dialog');
    if (dialog.open)
        return;
    dialog.classList.add('command-dialog');
    const root = $('dialog-content');
    root.replaceChildren(element('h2', '', 'Find an action'));
    const search = element('input', 'command-search');
    search.type = 'search';
    search.placeholder = 'Open files, clean metadata, find presets…';
    search.setAttribute('aria-label', 'Search actions');
    root.append(search);
    const list = element('div', 'command-results');
    root.append(list);
    const commands = [['Open files', 'Ctrl+O', () => openFiles()], ['Open a folder', '', () => openFiles(true)], ['Workspace overview', '', () => { tab = 'overview'; render(); }], ['Inspect-only mode', '', toggleMode], ['Compare files', '', () => { tab = 'compare'; render(); }], ['Batch edit', '', () => { tab = 'batch'; render(); }], ['Workspace report', '', () => { tab = 'reports'; render(); }], ['Prepare for sharing', '', () => { tab = 'sharing'; render(); }], ['Save copies', 'Ctrl+Shift+S', () => saveEntries(false)], ['Team presets', '', () => { tab = 'presets'; render(); }], ['Formats & help', '', () => { tab = 'guide'; render(); }], ['Save history', '', showHistory], ['Settings', '', showTools]];
    const fill = () => { list.replaceChildren(); for (const [label, key, action] of commands.filter(c => c[0].toLowerCase().includes(search.value.toLowerCase()))) {
        const item = button(label, undefined, () => { dialog.close(); return action(); }, 'command-item');
        if (key)
            item.append(element('kbd', '', key));
        list.append(item);
    } if (!list.children.length)
        list.append(element('p', 'hint', 'No matching action. Try “files” or “presets”.')); };
    search.addEventListener('input', fill);
    search.addEventListener('keydown', e => { if (e.key === 'ArrowDown') {
        e.preventDefault();
        list.querySelector('button')?.focus();
    } if (e.key === 'Enter') {
        e.preventDefault();
        list.querySelector('button')?.click();
    } });
    list.addEventListener('keydown', e => { const buttons = Array.from(list.querySelectorAll('button')); const i = buttons.indexOf(document.activeElement); if (e.key === 'ArrowDown') {
        e.preventDefault();
        buttons[(i + 1) % buttons.length]?.focus();
    } if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (i <= 0)
            search.focus();
        else
            buttons[i - 1]?.focus();
    } });
    root.append(element('p', 'hint', 'Type to filter · ↑ ↓ to choose · Enter to open · Esc to close'));
    fill();
    dialog.showModal();
    search.focus();
}
function render() {
    document.body.classList.toggle('welcome-mode', !active() && tab === 'fields');
    document.body.classList.toggle('utility-page', generalViews.includes(tab));
    for (const [id, on] of [['nav-workspace', !generalViews.includes(tab)], ['nav-overview', tab === 'overview'], ['nav-compare', tab === 'compare'], ['nav-batch', tab === 'batch'], ['nav-reports', tab === 'reports'], ['nav-presets', tab === 'presets'], ['nav-formats', tab === 'guide']])
        $(id).classList.toggle('active', on);
    renderLibrary();
    renderHeader();
    renderTabs();
    const root = $('editor');
    root.replaceChildren();
    const entry = active();
    if (tab === 'overview')
        renderOverview(root);
    else if (tab === 'compare')
        renderCompare(root);
    else if (tab === 'batch')
        renderBatch(root);
    else if (tab === 'reports')
        renderReports(root);
    else if (tab === 'guide')
        renderGuide(root);
    else if (tab === 'sharing' && entry)
        renderSharing(entry, root);
    else if (tab === 'presets')
        renderPresets(root);
    else if (tab === 'history')
        renderHistory(root);
    else if (tab === 'tools')
        renderTools(root);
    else if (!entry)
        welcome(root);
    else if (tab === 'fields')
        renderFields(entry, root);
    else if (tab === 'evidence')
        renderEvidence(entry, root);
    else if (tab === 'artwork')
        renderArtwork(entry, root);
    else if (tab === 'raw')
        renderRaw(entry, root);
    else if (tab === 'audit')
        renderAudit(entry, root);
    else if (tab === 'streams')
        renderStreams(entry, root);
    renderInspector();
    renderFooter();
    const view = (current ?? 'welcome') + '|' + tab;
    if (view !== lastView) {
        root.scrollTop = 0;
        lastView = view;
    }
}
function init() {
    $('add-files').append(icon('add', 16), document.createTextNode('Add files'));
    $('add-files').addEventListener('click', () => void openFiles().catch(showError));
    $('add-folder').append(icon('folder', 16), document.createTextNode('Add folder'));
    $('add-folder').addEventListener('click', () => void openFiles(true).catch(showError));
    $('command-button').addEventListener('click', showCommands);
    $('session-mode').addEventListener('click', () => void toggleMode().catch(showError));
    for (const [id, name, view] of [['nav-workspace', 'file', 'fields'], ['nav-overview', 'grid', 'overview'], ['nav-compare', 'compare', 'compare'], ['nav-batch', 'layers', 'batch'], ['nav-reports', 'download', 'reports'], ['nav-presets', 'spark', 'presets'], ['nav-formats', 'help', 'guide']]) {
        $(id).prepend(icon(name, 17));
        $(id).addEventListener('click', () => { tab = view; render(); });
    }
    document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        showCommands();
    } });
    applyPreferences();
    $('search-icon').append(icon('search', 15));
    $('history-button').append(icon('history'));
    $('tools-button').append(icon('settings'));
    $('history-button').addEventListener('click', () => void showHistory());
    $('tools-button').addEventListener('click', () => void showTools());
    $('file-search').addEventListener('input', e => { search = e.target.value; renderLibrary(); });
    $('select-all').addEventListener('change', e => { for (const entry of visibleEntries())
        entry.selected = e.target.checked; render(); });
    $('clear-workspace').addEventListener('click', () => void (async () => { if (busy)
        return; if ([...entries.values()].some(e => dirty(e.patch)) && !await confirmDialog('Clear workspace?', 'Discard all staged edits? Files on disk are not removed.'))
        return; entries.clear(); current = null; tab = 'fields'; announceDirty(); render(); })().catch(showError));
    $('stop-jobs').addEventListener('click', () => { stop = true; toast('Stopping after the current file. A native write will not be interrupted midway.'); });
    document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drop-active'); });
    document.addEventListener('dragleave', e => { if (!e.relatedTarget)
        document.body.classList.remove('drop-active'); });
    document.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('drop-active'); if (busy || !e.dataTransfer)
        return; void bridge.dropped(Array.from(e.dataTransfer.files)).then(importResult).catch(showError); });
    if (window.KI_PREVIEW)
        $('preview-banner').hidden = false;
    render();
    if (!bridge) {
        showError('The native desktop bridge is unavailable. Launch this app in Electron.');
        return;
    }
    bridge.onOpenFiles(pick => void importResult(pick));
    bridge.onSession(state => { session = state; render(); });
    void bridge.sessionState().then(state => { session = state; render(); return bridge.launchFiles(); }).then(importResult).catch(showError);
    bridge.onMenu(action => { const handlers = { open: () => openFiles(), folder: () => openFiles(true), save: () => saveEntries(false), replace: () => saveEntries(true), history: showHistory, tools: showTools, commands: showCommands }; try {
        const result = handlers[action]?.();
        if (result instanceof Promise)
            void result.catch(showError);
    }
    catch (e) {
        showError(e);
    } });
    void bridge.doctor().then(d => { diagnostics = d; renderFooter(); }).catch(() => { });
    void loadPresets().then(() => { if (tab === 'presets')
        render(); }).catch(showError);
}
init();
//# sourceMappingURL=app.js.map