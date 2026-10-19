export const FIELDS = [
    { key: 'subject', label: 'Subject', group: 'Identity' },
    { key: 'company', label: 'Company', group: 'Credits' }, { key: 'manager', label: 'Manager', group: 'Credits' },
    { key: 'category', label: 'Category', group: 'Details' }, { key: 'rating', label: 'Rating', group: 'Details', placeholder: '0–5' },
    { key: 'last_modified_by', label: 'Last modified by', group: 'Credits' }, { key: 'initial_creator', label: 'Initial creator', group: 'Credits' },
    { key: 'software', label: 'Creation software', group: 'Details' },
    { key: 'title', label: 'Title', group: 'Identity' }, { key: 'artist', label: 'Artist / Creator', group: 'Identity' },
    { key: 'album_artist', label: 'Album artist', group: 'Identity' }, { key: 'album', label: 'Album / Collection', group: 'Identity' },
    { key: 'label', label: 'Label / Credit', group: 'Release' }, { key: 'publisher', label: 'Publisher', group: 'Release' },
    { key: 'date', label: 'Date / Year', group: 'Release', placeholder: '2026 or 2026-09-23' }, { key: 'genre', label: 'Genre', group: 'Release' },
    { key: 'track', label: 'Track', group: 'Release' }, { key: 'track_total', label: 'Track count', group: 'Release' },
    { key: 'disc', label: 'Disc', group: 'Release' }, { key: 'disc_total', label: 'Disc count', group: 'Release' },
    { key: 'isrc', label: 'ISRC', group: 'Release', placeholder: 'Only an assigned recording code' },
    { key: 'catalog_number', label: 'Catalog number', group: 'Release' },
    { key: 'composer', label: 'Composer', group: 'Credits' }, { key: 'lyricist', label: 'Lyricist', group: 'Credits' },
    { key: 'producer', label: 'Producer', group: 'Credits' }, { key: 'copyright', label: 'Copyright notice', group: 'Credits' },
    { key: 'language', label: 'Language', group: 'Details' }, { key: 'website', label: 'Artist website', group: 'Details' },
    { key: 'keywords', label: 'Keywords', group: 'Details', placeholder: 'Separate with semicolons' },
    { key: 'description', label: 'Description', group: 'Details', multiline: true },
    { key: 'comment', label: 'Comment', group: 'Details', multiline: true }, { key: 'lyrics', label: 'Lyrics', group: 'Details', multiline: true }
];
export function emptyPatch() { return { fields: {}, raw: [], policy: 'keep', artwork: { action: 'keep' } }; }
export function dirty(p) { return Object.keys(p.fields).length > 0 || p.raw.length > 0 || p.policy !== 'keep' || p.artwork.action !== 'keep'; }
export function changeCount(p) { return Object.keys(p.fields).length + p.raw.length + (p.policy === 'keep' ? 0 : 1) + (p.artwork.action === 'keep' ? 0 : 1); }
export const POLICY_LABELS = { keep: 'Keep other tags', privacy: 'Privacy cleanup', clear_descriptive: 'Clear descriptive', strip_metadata: 'Strip image metadata' };
export function supportsPolicy(doc, policy) {
    return doc.capabilities.policies.includes(policy) && (policy !== 'strip_metadata' || (doc.kind === 'image' && ['JPEG', 'JPG', 'PNG', 'APNG', 'WEBP'].includes(doc.format.toUpperCase())));
}
export function setPolicy(doc, p, policy) {
    if (!supportsPolicy(doc, policy))
        throw Error(`${POLICY_LABELS[policy]} is unavailable for ${doc.format}.`);
    p.policy = policy;
    if (policy === 'strip_metadata') {
        p.fields = {};
        p.raw = [];
        p.artwork = { action: 'keep' };
    }
}
export function valueFor(doc, p, key) {
    if (p.policy === 'strip_metadata')
        return '';
    if (Object.hasOwn(p.fields, key))
        return p.fields[key] ?? '';
    if (p.policy === 'clear_descriptive')
        return '';
    if (p.policy === 'privacy' && (Array.isArray(doc.properties.privacy_clears) ? doc.properties.privacy_clears.includes(key) : ['comment', 'description'].includes(key)))
        return '';
    if (p.policy === 'privacy' && doc.properties.adapter === 'exiftool')
        return '';
    return doc.fields[key] ?? '';
}
export function editField(doc, p, key, value) {
    if (p.policy === 'strip_metadata')
        throw Error('Strip image metadata does not allow added fields. Choose another policy to edit tags.');
    if (!doc.capabilities.fields.includes(key))
        throw Error(`Field ${key} is not writable for ${doc.format}.`);
    const original = doc.fields[key] ?? '';
    if (p.policy === 'keep' && value === original)
        delete p.fields[key];
    else
        p.fields[key] = value || null;
}
export function applyPreset(doc, p, preset) {
    if (!supportsPolicy(doc, preset.policy))
        return [`${POLICY_LABELS[preset.policy]} is unavailable for ${doc.format}`];
    if (preset.policy === 'strip_metadata' && Object.keys(preset.fields).length)
        return ['Strip image metadata presets cannot add fields'];
    setPolicy(doc, p, preset.policy);
    const skipped = [];
    for (const [key, value] of Object.entries(preset.fields)) {
        if (doc.capabilities.fields.includes(key))
            editField(doc, p, key, value);
        else
            skipped.push(key);
    }
    return skipped;
}
export function copyStagedPatch(source, patch, doc, target) {
    if (!supportsPolicy(doc, patch.policy))
        return [`${POLICY_LABELS[patch.policy]} is unavailable for ${doc.format}`];
    if (patch.policy === 'strip_metadata') {
        if (Object.keys(patch.fields).length || patch.raw.length || patch.artwork.action !== 'keep')
            return ['Strip image metadata cannot include metadata edits'];
        setPolicy(doc, target, patch.policy);
        return [];
    }
    const unsupported = Object.keys(patch.fields).filter(key => !doc.capabilities.fields.includes(key));
    if (unsupported.length)
        return unsupported;
    setPolicy(doc, target, patch.policy);
    target.fields = structuredClone(patch.fields);
    if (doc.kind === source.kind && doc.capabilities.artwork)
        target.artwork = structuredClone(patch.artwork);
    return [];
}
export function setRaw(doc, p, edit) {
    if (p.policy === 'strip_metadata')
        throw Error('Strip image metadata does not allow native field edits. Choose another policy to edit tags.');
    const source = doc.raw.find(r => r.namespace === edit.namespace && r.key === edit.key);
    if (source && !source.writable)
        throw Error('This field is inspection-only.');
    p.raw = p.raw.filter(r => r.namespace !== edit.namespace || r.key !== edit.key);
    if ((source?.value ?? null) !== edit.value)
        p.raw.push({ ...edit });
}
export function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0)
        return 'Unknown';
    if (value < 1024)
        return value + ' B';
    if (value < 1024 ** 2)
        return (value / 1024).toFixed(1) + ' KiB';
    if (value < 1024 ** 3)
        return (value / 1024 ** 2).toFixed(1) + ' MiB';
    return (value / 1024 ** 3).toFixed(2) + ' GiB';
}
export function formatDuration(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
        return '—';
    const total = Math.floor(n);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
export function findings(doc) {
    // Heuristic findings are prompts for review, never a privacy certification.
    return doc.raw.filter(r => /gps|location|serial|owner|author|creator|lastmodified|createdate|modifydate|manager|company|documentid|instanceid|originalfilename|encodedby|encodersoftware|creation_time|comment|sourceurl|software|email|c2pa|jumbf|parameters|prompt|workflow|comfy|stable.?diffusion|generation/i.test(r.namespace + ' ' + r.key)).map(r => ({ label: r.key, namespace: r.namespace, key: r.key }));
}
export function policyDescription(policy, kind) {
    if (policy === 'strip_metadata')
        return 'Remove EXIF (including GPS and orientation), XMP, IPTC, comments, C2PA / JUMBF, embedded color profiles, and AI generation metadata, including Stable Diffusion parameters and ComfyUI workflows. Clears staged tags. Encoded image and animation data stay unchanged without recompression; pixel watermarks remain.';
    if (policy === 'keep')
        return 'Only staged fields change. Other recognized metadata is retained.';
    if (kind === 'document')
        return 'Clear document properties, then apply any staged fields. Content, comments, tracked changes, speaker notes and embedded files retain their contents.';
    if (policy === 'privacy')
        return 'Remove the writer’s enumerated sensitive fields. Unknown identifiers can remain. Review output.';
    if (kind === 'video')
        return 'Clear container-level descriptive tags. Track tags, chapters and attachments are not globally stripped.';
    if (kind === 'image')
        return 'Clear recognized descriptive blocks. Preserve image data, color information and effective orientation.';
    return 'Remove recognized tag families before applying staged values. Artwork in those tags is also removed.';
}
export function orientationWarning(doc) {
    const inventory = doc.properties.image_privacy;
    const orientation = Number(inventory?.exif_orientation ?? doc.properties.orientation);
    if (orientation > 1 && orientation <= 8)
        return `EXIF orientation ${orientation} will be removed. This image may display rotated or flipped after stripping.`;
    if (inventory?.exif_orientation === null && inventory.categories.includes('EXIF'))
        return 'EXIF orientation could not be confirmed; removing it may change the displayed rotation or flip.';
    return null;
}
export function appearanceWarnings(doc) {
    const warnings = [];
    const orientation = orientationWarning(doc);
    if (orientation)
        warnings.push(orientation);
    if ((doc.properties.image_privacy?.color_profiles ?? 0) > 0)
        warnings.push('Embedded color profiles will be removed; colors can change.');
    return warnings;
}
export function sharingPolicy(doc) {
    if (supportsPolicy(doc, 'strip_metadata'))
        return 'strip_metadata';
    if (supportsPolicy(doc, 'privacy'))
        return 'privacy';
    return null;
}
export function canEdit(doc) { return doc.capabilities.fields.length > 0 || doc.capabilities.raw_edit || doc.capabilities.policies.some(p => p !== 'keep') || doc.capabilities.artwork; }
//# sourceMappingURL=model.js.map