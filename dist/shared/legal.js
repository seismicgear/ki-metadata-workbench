export const LEGAL_VERSION = 'metadata-notice-2026-11-07';
export const LEGAL_DATE = 'November 7, 2026';
export const LEGAL_LINKS = {
    contact: 'https://kuykendall.industries/contact?category=Privacy%20%2F%20Data%20Request',
    privacy: 'https://kuykendall.industries/privacy',
};
export const LEGAL_SECTIONS = [
    { heading: 'About METADATA', paragraphs: [
            'METADATA is a free, standalone desktop utility provided by Kuykendall Industries, LLC. It requires no account, subscription or license activation. You may use official KI builds for personal or work files you are authorized to process. You retain your rights to your files; this notice grants KI no right to use their contents for model training.',
            'Release candidates are previews. Work on copies and review the results before relying on or sharing them. A separate agreement you have with KI and rights that cannot be limited by law remain in effect.',
        ] },
    { heading: 'Processing on your device', paragraphs: [
            'The desktop processes files you select, drop into it or open with it. This can include file contents, names and paths, embedded images, authors, location metadata, prompts and other descriptive fields, file fingerprints, and your edit or export instructions. Processing occurs on your computer. The app does not upload these records to KI or a model provider and does not collect analytics or send automatic diagnostics.',
            'Display preferences, tool settings, presets and save history are stored locally. Local tools process the selected files; choose only trusted replacement tools. Your operating system, employer, shared folders, cloud synchronization or backup services may separately access or copy files under their own settings.',
        ] },
    { heading: 'Retention and removal', paragraphs: [
            'Clearing the workspace removes its file list, not files on disk. Saving a copy preserves the original. Replacing an original creates a complete backup in a .ki-backups folder beside it. History, audits, presets, exports and backups may retain names, paths, fingerprints and private metadata, including information removed from a cleaned file.',
            'These records do not expire automatically. Uninstalling the app does not remove its local settings and history. Settings shows the local configuration and history folder. Close the app and use your operating system to remove records you no longer need, including separate originals, backups and exports. Removal is not secure erasure and does not remove copies held by other backup or synchronization services. KI cannot retrieve or remotely delete files that remain solely on your device.',
        ] },
    { heading: 'Exports and cleanup results', paragraphs: [
            'Exports are saved where you choose. Review files, reports, audits and preset packs before sharing them: an audit or source snapshot can contain details absent from a cleaned file. Metadata cleanup does not redact visible content or guarantee anonymity, ownership, authenticity or compliance with a particular law. Its scope depends on the format and selected policy; external copies, sidecar files and filesystem information can remain.',
        ] },
    { heading: 'Contact, support and privacy requests', paragraphs: [
            'If you contact KI, KI receives the details and materials you choose to send. That information is handled under the KI Privacy Policy. Use the KI contact form for support or a request to access, correct, export or delete information KI holds about you. Send only what is needed to explain the request. Opening these links uses your browser; it does not attach your files or history.',
            'Kuykendall Industries, LLC · contact@forwarding.kuykendall.industries · (208) 500-2410. The KI contact form and Privacy Policy are available from the buttons below and at kuykendall.industries. GitHub separately processes visits and downloads under its own terms and privacy notice.',
        ] },
    { heading: 'Software, licenses and updates', paragraphs: [
            'METADATA does not automatically download updates. Obtain updates from the official KI release page and review the notice included with that version. Third-party components retain their own licenses; their notices and applicable source materials accompany the downloads. Free use of this utility does not change those licenses or make KI proprietary code open source. This notice does not replace the terms attached to a different KI product or an earlier download.',
        ] },
];
//# sourceMappingURL=legal.js.map