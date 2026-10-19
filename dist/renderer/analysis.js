import { canEdit, dirty, valueFor } from './model.js';
export const CATEGORY_LABELS = { location: 'Location', identity: 'People & identifiers', generation: 'AI generation', provenance: 'Content provenance', timestamps: 'Dates & times', comments: 'Comments & links', technical: 'Technical', other: 'Other' };
export function classifyTag(field) {
    const key = field.namespace + ' ' + field.key;
    if (/gps|latitude|longitude|geotag|location|geographic/i.test(key))
        return 'location';
    if (/c2pa|jumbf|manifest.?store|content.?credential|ingredient|claim_generator/i.test(key))
        return 'provenance';
    if (/parameters|negative.?prompt|prompt|workflow|comfy|stable.?diffusion|generation|sampler|cfg.?scale|model.?hash|ai.?tool/i.test(key))
        return 'generation';
    if (/serial|owner|author|artist|creator|lastmodifiedby|last.?modified.?by|manager|company|documentid|instanceid|originalfilename|email|person|username|account/i.test(key))
        return 'identity';
    if (/date|timestamp|creation_time|modify_time|timecreated|timemodified/i.test(key))
        return 'timestamps';
    if (/comment|description|sourceurl|url|website|history|instructions/i.test(key))
        return 'comments';
    if (/file|system|codec|profile|width|height|duration|bitrate|channels|sample|format|software|encoder|compression|orientation|resolution/i.test(key))
        return 'technical';
    return 'other';
}
export function metadataFindings(doc) {
    const result = doc.raw.map(f => ({ category: classifyTag(f), namespace: f.namespace, key: f.key })).filter(f => !['technical', 'other'].includes(f.category));
    // The strict parser can inventory a whole block without exposing individual tags.
    for (const name of doc.properties.image_privacy?.categories ?? []) {
        const cat = /c2pa|jumbf/i.test(name) ? 'provenance' : /ai|generation/i.test(name) ? 'generation' : /gps/i.test(name) ? 'location' : 'other';
        if (cat !== 'other' && !result.some(r => r.category === cat))
            result.push({ category: cat, namespace: 'Image container', key: name });
    }
    return result;
}
export function metadataDiff(a, b) {
    const rows = new Map();
    const add = (doc, side) => { for (const raw of doc.raw) {
        const key = JSON.stringify([raw.namespace, raw.key]);
        let row = rows.get(key);
        if (!row) {
            row = { namespace: raw.namespace, key: raw.key, before: [], after: [], status: 'unchanged' };
            rows.set(key, row);
        }
        row[side].push(raw.value);
    } };
    add(a, 'before');
    add(b, 'after');
    for (const row of rows.values()) {
        row.before.sort();
        row.after.sort();
        row.status = !row.before.length ? 'added' : !row.after.length ? 'removed' : JSON.stringify(row.before) === JSON.stringify(row.after) ? 'unchanged' : 'changed';
    }
    return [...rows.values()].sort((a, b) => (a.namespace + '\0' + a.key).localeCompare(b.namespace + '\0' + b.key));
}
export function isSavedOutput(entry) { return !!entry.result && entry.result.after.path === entry.doc.path && entry.result.after.etag === entry.doc.etag; }
export function fileState(entry) { return dirty(entry.patch) ? 'Staged' : isSavedOutput(entry) ? 'Saved' : canEdit(entry.doc) ? 'Ready' : 'Inspect only'; }
export function duplicateGroups(entries) {
    const groups = new Map();
    for (const e of entries) {
        if (!e.doc.etag)
            continue;
        const set = groups.get(e.doc.etag) ?? [];
        set.push(e);
        groups.set(e.doc.etag, set);
    }
    return [...groups.values()].filter(g => g.length > 1);
}
export function buildReport(entries, options) {
    if (entries.length > 1000)
        throw Error('Reports are limited to 1,000 files.');
    if (options.includeValues && entries.reduce((size, e) => size + e.doc.raw.reduce((n, r) => n + r.namespace.length + r.key.length + r.value.length, 0) + Object.values(e.doc.fields).reduce((n, v) => n + v.length, 0), 0) > 8 * 1024 * 1024)
        throw Error('The selected metadata is too large for one detailed report. Select fewer files or omit source tag values.');
    return {
        schema: 'industries.kuykendall.metadata.report', schema_version: 1, application: 'KI Metadata Workbench', version: '0.4.0',
        generated_at: options.generatedAt ?? new Date().toISOString(), case_name: options.caseName.trim().slice(0, 200),
        scope: 'Local metadata inventory. Fingerprints identify file bytes; findings are review prompts. No malware detection, C2PA signature validation or anonymity certification is performed.',
        disclosure: { filenames: options.includeNames, full_paths: options.includePaths, metadata_values: options.includeValues },
        totals: { files: entries.length, bytes: entries.reduce((n, e) => n + e.doc.size, 0), editable: entries.filter(e => canEdit(e.doc)).length, with_findings: entries.filter(e => metadataFindings(e.doc).length).length, duplicate_groups: duplicateGroups(entries).length },
        files: entries.map((entry, index) => {
            const doc = entry.doc, evidence = doc.properties.evidence, findings = metadataFindings(doc);
            const categories = Object.fromEntries(Object.keys(CATEGORY_LABELS).map(category => [category, findings.filter(f => f.category === category).length]).filter(([, count]) => count));
            const saved = isSavedOutput(entry) ? entry.result : undefined;
            return {
                file_id: 'FILE-' + String(index + 1).padStart(4, '0'), ...(options.includeNames ? { name: doc.name } : {}), ...(options.includePaths ? { path: doc.path } : {}),
                kind: doc.kind, format: doc.format, bytes: doc.size, sha256: evidence?.sha256 ?? null, blake3: doc.etag,
                signature: evidence?.detected_type ?? null, extension_status: evidence?.extension_status ?? 'unknown',
                metadata_count: doc.raw.length, findings: categories, warning_count: doc.warnings.length, status: fileState(entry),
                capabilities: { fields: [...doc.capabilities.fields], policies: [...doc.capabilities.policies], writer: doc.capabilities.writer },
                staged: { fields: Object.keys(entry.patch.fields), raw_fields: entry.patch.raw.length, policy: entry.patch.policy, artwork: entry.patch.artwork.action },
                verification: saved ? { status: saved.verification.status, method: saved.verification.method, before: saved.verification.before, after: saved.verification.after, saved_at_ms: saved.saved_at_ms ?? null } : null,
                ...(options.includeValues ? { fields: { ...doc.fields }, raw: doc.raw.filter(f => options.includePaths || !(/^(System|File)$/i.test(f.namespace) && /directory|filepath/i.test(f.key))).filter(f => options.includeNames || !(/^(System|File)$/i.test(f.namespace) && /^filename$/i.test(f.key))).map(f => ({ ...f })) } : {}),
            };
        })
    };
}
export function csvCell(value) {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Quoting alone does not prevent spreadsheet formula evaluation, including after leading whitespace.
    if (/^[\s\u0000-\u001f\u007f-\u009f\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))
        text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
}
export function csvReport(report) {
    const columns = ['file_id', ...(report.disclosure.filenames ? ['name'] : []), ...(report.disclosure.full_paths ? ['path'] : []), 'kind', 'format', 'bytes', 'sha256', 'blake3', 'signature', 'extension_status', 'metadata_count', 'findings', 'warning_count', 'status', 'verification', ...(report.disclosure.metadata_values ? ['fields', 'raw'] : [])];
    return [columns.map(csvCell).join(','), ...report.files.map(file => columns.map(key => csvCell(file[key])).join(','))].join('\r\n') + '\r\n';
}
export function bulkPlan(entries, options) {
    if (options.operation === 'replace' && !options.find)
        throw Error('Enter the text to find.');
    if (options.value.length > 1048576 || options.value.includes('\0'))
        throw Error('Values must be NUL-free and at most 1 MiB.');
    const escaped = options.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = options.operation === 'replace' ? new RegExp(escaped, options.caseSensitive ? 'g' : 'gi') : null;
    return entries.map(entry => {
        const before = valueFor(entry.doc, entry.patch, options.field);
        const compatible = entry.doc.capabilities.fields.includes(options.field) && entry.patch.policy !== 'strip_metadata';
        const after = options.operation === 'remove' ? '' : options.operation === 'set' ? options.value : before.replace(pattern, () => options.value);
        return { path: entry.doc.path, name: entry.doc.name, before, after, compatible, changed: compatible && before !== after, reason: entry.patch.policy === 'strip_metadata' ? 'Strict image stripping is staged' : compatible ? '' : 'Field is unavailable for this file' };
    });
}
//# sourceMappingURL=analysis.js.map