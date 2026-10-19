use crate::model::*;
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::{config::WriteOptions, file::{AudioFile, TaggedFileExt}, picture::{Picture, PictureType}, tag::{ItemKey, ItemValue, Tag, TagType}};
use serde_json::json;
use std::{fs::File, path::Path};

pub fn field_map() -> Vec<(&'static str, ItemKey)> {
    use ItemKey::*;
    vec![
        ("title", TrackTitle), ("artist", TrackArtist), ("album_artist", AlbumArtist),
        ("album", AlbumTitle), ("composer", Composer), ("lyricist", Lyricist),
        ("producer", Producer), ("label", Label), ("publisher", Publisher),
        ("date", RecordingDate), ("genre", Genre), ("track", TrackNumber),
        ("track_total", TrackTotal), ("disc", DiscNumber), ("disc_total", DiscTotal),
        ("copyright", CopyrightMessage), ("isrc", Isrc), ("catalog_number", CatalogNumber),
        ("comment", Comment), ("lyrics", UnsyncLyrics), ("description", Description),
        ("language", Language), ("website", TrackArtistUrl),
    ]
}
fn primary(file: &lofty::file::TaggedFile) -> TagType {
    // RIFF INFO cannot represent the complete release fields. Write ID3 in WAV/AIFF,
    // while preserving existing native tag families unless explicitly cleared.
    match file.file_type() {
        lofty::file::FileType::Wav | lofty::file::FileType::Aiff => TagType::Id3v2,
        _ => file.primary_tag_type(),
    }
}
fn as_string(value: &ItemValue) -> String {
    match value {
        ItemValue::Text(s) | ItemValue::Locator(s) => s.clone(),
        ItemValue::Binary(b) => format!("[{} binary bytes; BLAKE3 {}]", b.len(), blake3::hash(b)),
    }
}
pub fn inspect(path: &Path, document: &mut Inspection) -> Result<()> {
    let file = lofty::read_from_path(path).context("Native audio metadata reader could not parse this file")?;
    let tag_type = primary(&file);
    let mut ordered = Vec::new();
    if let Some(p) = file.tag(tag_type) { ordered.push(p); }
    ordered.extend(file.tags().iter().filter(|t| t.tag_type() != tag_type));
    for (field, key) in field_map() {
        for tag in &ordered {
            if let Some(value) = tag.get_string(key) {
                document.fields.insert(field.to_owned(), value.to_owned()); break;
            }
        }
    }
    // Fall back to the less specific year / lyrics representations when necessary.
    if !document.fields.contains_key("date") {
        for tag in &ordered {
            if let Some(value) = tag.get_string(ItemKey::Year) { document.fields.insert("date".into(), value.into()); break; }
        }
    }
    if !document.fields.contains_key("lyrics") {
        for tag in &ordered {
            if let Some(value) = tag.get_string(ItemKey::Lyrics) { document.fields.insert("lyrics".into(), value.into()); break; }
        }
    }
    for tag in file.tags() {
        let namespace = format!("{:?}", tag.tag_type());
        for item in tag.items() {
            let key = item.key();
            let text = matches!(item.value(), ItemValue::Text(_) | ItemValue::Locator(_));
            document.raw.push(RawField {
                namespace: namespace.clone(), key: format!("{key:?}"), value: as_string(item.value()), writable: text,
            });
        }
        if tag.has_format_specific_items() {
            document.warnings.push(format!("{namespace} contains format-specific items preserved by the native library but not expanded in the normalized inspector. This is not a complete byte-forensic inventory."));
        }
        for pic in tag.pictures() {
            let mime = pic.mime_type().map(ToString::to_string).unwrap_or_else(|| "application/octet-stream".into());
            let preview_ok = matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp") && pic.data().len() <= 4 * 1024 * 1024;
            let index = document.artwork.len();
            document.artwork.push(Artwork {
                index, kind: format!("{:?}", pic.pic_type()), mime: mime.clone(), bytes: pic.data().len(),
                description: pic.description().unwrap_or("").to_string(),
                data_url: preview_ok.then(|| format!("data:{mime};base64,{}", STANDARD.encode(pic.data()))),
            });
        }
    }
    let p = file.properties();
    document.properties = json!({
        "duration_seconds": p.duration().as_secs_f64(), "sample_rate": p.sample_rate(),
        "channels": p.channels(), "bit_depth": p.bit_depth(), "audio_bitrate_kbps": p.audio_bitrate(),
        "tag_family": format!("{tag_type:?}"), "native_format": format!("{:?}", file.file_type()),
        "extra_fields": ItemKey::supported_keys(tag_type).iter().map(|k| format!("{k:?}")).collect::<Vec<_>>()
    });
    document.capabilities = Capabilities {
        fields: field_map().iter().filter(|(_, key)| key.map_key(tag_type).is_some()).map(|(s, _)| s.to_string()).collect(),
        artwork: !matches!(tag_type, TagType::RiffInfo | TagType::AiffText | TagType::Id3v1),
        raw_edit: true, policies: vec!["keep".into(), "clear_descriptive".into(), "privacy".into()],
        writer: "Rust / Lofty".into(),
    };
    document.warnings.push("Tag editing does not remove audio watermarks, fingerprints, codec headers, or filesystem metadata. A clean tag list is not a guarantee of anonymity.".into());
    Ok(())
}
fn sensitive(key: ItemKey) -> bool {
    use ItemKey::*;
    matches!(key, Comment | Description | EncodedBy | EncoderSoftware | EncoderSettings | EncodingTime |
        OriginalFileName | FileOwner | TaggingTime | AudioFileUrl | AudioSourceUrl | PodcastGlobalUniqueId)
}
fn parse_key(key: &str) -> Result<ItemKey> {
    ItemKey::VARIANTS.iter().copied().find(|k| format!("{k:?}") == key)
        .ok_or_else(|| anyhow!("Unsupported native audio key: {key}"))
}
pub fn write(path: &Path, patch: &Patch) -> Result<Vec<String>> {
    let mut file = lofty::read_from_path(path)?;
    let tag_type = primary(&file);
    let mut warnings = Vec::new();
    let options = WriteOptions::new().respect_read_only(false).use_id3v23(true);
    if patch.policy == Policy::ClearDescriptive {
        let families: Vec<_> = file.tags().iter().map(|t| t.tag_type()).collect();
        for family in families {
            // Lofty's path-removal helper opens a read-only handle. Removal
            // requires the explicit read/write handle on the staging file.
            let mut handle = File::options().read(true).write(true).open(path)?;
            family.remove_from(&mut handle, options)?;
        }
        file = lofty::read_from_path(path)?;
    }
    if file.tag(tag_type).is_none() { file.insert_tag(Tag::new(tag_type)); }
    let families: Vec<_> = file.tags().iter().map(|t| t.tag_type()).collect();
    if patch.policy == Policy::Privacy {
        for family in &families {
            if let Some(tag) = file.tag_mut(*family) { tag.retain(|item| !sensitive(item.key())); }
        }
        warnings.push("Audio privacy policy removes the enumerated software, comment, owner, date-of-encoding and source-path fields. Unknown/private tags may remain; inspect the output.".into());
    }
    // Apply a sparse patch, not a regenerated tag set. Unedited fields are retained.
    for (field, value) in &patch.fields {
        let key = field_map().into_iter().find(|(f, _)| *f == field).map(|(_, k)| k)
            .ok_or_else(|| anyhow!("Unknown audio field: {field}"))?;
        if key.map_key(tag_type).is_none() { bail!("{field} is not writable for {tag_type:?}"); }
        for family in &families {
            if let Some(tag) = file.tag_mut(*family) {
                tag.remove_key(key);
                if field == "date" { tag.remove_key(ItemKey::Year); tag.remove_key(ItemKey::ReleaseDate); }
                if field == "lyrics" { tag.remove_key(ItemKey::Lyrics); }
            }
        }
        if let Some(text) = value {
            let tag = file.tag_mut(tag_type).context("Missing destination tag")?;
            if !tag.insert_text(key, text.clone()) { bail!("The native writer rejected field {field}"); }
        }
    }
    for edit in &patch.raw {
        let key = parse_key(&edit.key)?;
        let family = families.iter().copied().find(|f| format!("{f:?}") == edit.namespace)
            .ok_or_else(|| anyhow!("Unknown tag family {}", edit.namespace))?;
        let tag = file.tag_mut(family).context("Tag family disappeared")?;
        tag.remove_key(key);
        if let Some(text) = &edit.value {
            if !tag.insert_text(key, text.clone()) { bail!("Native tag does not support {}", edit.key); }
        }
    }
    if !matches!(patch.artwork, ArtworkEdit::Keep) {
        for family in &families {
            if let Some(tag) = file.tag_mut(*family) {
                while !tag.pictures().is_empty() { tag.remove_picture(0); }
            }
        }
        if let ArtworkEdit::Replace { path: artwork_path } = &patch.artwork {
            let art = Path::new(artwork_path);
            if std::fs::metadata(art)?.len() > 16 * 1024 * 1024 { bail!("Artwork exceeds the 16 MiB limit"); }
            let mut picture = Picture::from_reader(&mut File::open(art)?)?;
            let mime = picture.mime_type().map(ToString::to_string).unwrap_or_default();
            if !matches!(mime.as_str(), "image/jpeg" | "image/png") { bail!("Cover artwork must be JPEG or PNG"); }
            picture.set_pic_type(PictureType::CoverFront);
            file.tag_mut(tag_type).context("Missing artwork destination")?.push_picture(picture);
        }
    }
    // Saving an empty tag does not automatically remove other families. Explicitly
    // removed families above are already gone from the staged file.
    file.save_to_path(path, options)?;
    Ok(warnings)
}
pub fn artwork_bytes(path: &Path, index: usize) -> Result<Vec<u8>> {
    let file = lofty::read_from_path(path)?;
    file.tags().iter().flat_map(|t| t.pictures()).nth(index)
        .map(|p| p.data().to_vec()).ok_or_else(|| anyhow!("Artwork index is no longer present"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn field_names_are_unique() {
        let pairs = field_map(); let mut names: Vec<_> = pairs.iter().map(|p| p.0).collect();
        let len = names.len(); names.sort(); names.dedup(); assert_eq!(names.len(), len);
    }
    #[test] fn label_and_publisher_are_distinct() { assert_ne!(ItemKey::Label, ItemKey::Publisher); }
    #[test] fn privacy_retains_rights_and_artists() {
        assert!(!sensitive(ItemKey::CopyrightMessage)); assert!(!sensitive(ItemKey::TrackArtist));
        assert!(sensitive(ItemKey::OriginalFileName));
    }
    #[test] fn raw_key_is_not_arbitrary_code() { assert!(parse_key("; rm -rf /").is_err()); }
}
