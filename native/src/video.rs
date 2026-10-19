use crate::{model::*, tools};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path};

pub fn field_map() -> BTreeMap<&'static str, &'static str> {
    BTreeMap::from([("title","title"),("artist","artist"),("album_artist","album_artist"),
        ("album","album"),("composer","composer"),("label","label"),("publisher","publisher"),
        ("date","date"),("genre","genre"),("copyright","copyright"),("comment","comment"),
        ("description","description"),("isrc","ISRC")])
}
fn sensitive(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    ["location","gps","serial","encoder","software","creation_time","comment","description","com.apple.quicktime.location"].iter().any(|s| k.contains(s))
}
pub fn inspect(path: &Path, document: &mut Inspection) -> Result<()> {
    let probe = tools::probe(path)?;
    let tags = probe["format"]["tags"].as_object();
    for (field, native) in field_map() {
        if let Some(value) = tags.and_then(|t| t.iter().find(|(k,_)| k.eq_ignore_ascii_case(native)).map(|(_,v)| v)) {
            if let Some(value) = value.as_str() { document.fields.insert(field.into(), value.into()); }
        }
    }
    if let Some(tags) = tags {
        for (k,v) in tags { document.raw.push(RawField { namespace: "Container".into(), key:k.clone(),value:v.as_str().unwrap_or("").into(),writable:true }); }
    }
    if let Some(streams) = probe["streams"].as_array() {
        for (i,stream) in streams.iter().enumerate() {
            if let Some(tags) = stream["tags"].as_object() {
                for (k,v) in tags { document.raw.push(RawField { namespace:format!("Stream:{i}"),key:k.clone(),value:v.as_str().unwrap_or("").into(),writable:false }); }
            }
        }
    }
    document.properties = json!({"duration_seconds":probe["format"]["duration"].as_str().and_then(|v|v.parse::<f64>().ok()),
        "streams":probe["streams"],"chapters":probe["chapters"],"tag_family":"Container","container_name":probe["format"]["format_name"]});
    document.capabilities = Capabilities { fields:field_map().keys().map(|s|s.to_string()).collect(),artwork:false,raw_edit:true,
        policies:vec!["keep".into(),"clear_descriptive".into(),"privacy".into()],writer:"Rust-controlled FFmpeg stream copy".into() };
    document.warnings.push("Video edits remux the container. Unknown atoms, private metadata, timing, and player-specific behavior are not guaranteed to survive unchanged. All streams are mapped; an unsupported stream aborts rather than being dropped.".into());
    document.warnings.push("Track tags, chapters, subtitle text and attached objects are inspect-only. Clear descriptive removes container tags, not every place a video can contain metadata.".into());
    Ok(())
}
pub fn write(source: &Path, target: &Path, patch: &Patch) -> Result<Vec<String>> {
    if !matches!(patch.artwork, ArtworkEdit::Keep) { bail!("Video attachment editing is not available"); }
    let probe = tools::probe(source)?;
    let mut args: Vec<String> = ["-protocol_whitelist","file,pipe","-format_whitelist","mov,matroska,webm,avi,asf","-v","error","-nostdin","-y","-i"].iter().map(|s|s.to_string()).collect();
    args.push(source.to_string_lossy().into_owned());
    args.extend(["-map","0","-copy_unknown","-c","copy","-map_chapters","0"].iter().map(|s|s.to_string()));
    if patch.policy == Policy::ClearDescriptive { args.extend(["-map_metadata".into(),"-1".into()]); }
    else { args.extend(["-map_metadata".into(),"0".into()]); }
    if patch.policy == Policy::Privacy {
        if let Some(tags)=probe["format"]["tags"].as_object() {
            for key in tags.keys().filter(|k|sensitive(k)) { args.extend(["-metadata".into(),format!("{key}=")]); }
        }
        if let Some(streams)=probe["streams"].as_array() {
            for (i,s) in streams.iter().enumerate() {
                if let Some(tags)=s["tags"].as_object() { for key in tags.keys().filter(|k|sensitive(k)) {
                    args.extend([format!("-metadata:s:{i}"),format!("{key}=")]);
                }}
            }
        }
    }
    for (key,value) in &patch.fields {
        let map = field_map(); let native=map.get(key.as_str()).context("Unsupported video field")?;
        args.extend(["-metadata".into(),format!("{native}={}",value.as_deref().unwrap_or(""))]);
    }
    for edit in &patch.raw {
        if edit.namespace!="Container" || edit.key.is_empty() || edit.key.contains(['=','\0']) { bail!("Only named container metadata can be edited"); }
        args.extend(["-metadata".into(),format!("{}={}",edit.key,edit.value.as_deref().unwrap_or(""))]);
    }
    let ext=source.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
    if matches!(ext.as_str(),"mp4"|"mov"|"m4v") { args.extend(["-movflags".into(),"+use_metadata_tags".into()]); }
    args.extend(["-fflags".into(),"+bitexact".into(),target.to_string_lossy().into_owned()]);
    tools::run("ffmpeg",&args,1800)?;
    let after=tools::probe(target)?;
    if inventory(&probe)!=inventory(&after) { bail!("Stream inventory changed during remux. The output was not committed"); }
    Ok(vec!["A/V packet hashes do not prove timing, subtitle, attachment, chapter or rendered-picture equivalence. Review the remuxed copy in your intended player.".into()])
}
fn inventory(probe:&Value)->Vec<Value> {
    probe["streams"].as_array().map(|s|s.iter().map(|v|json!({
        "type":v["codec_type"],"codec":v["codec_name"],"width":v["width"],"height":v["height"],
        "channels":v["channels"],"sample_rate":v["sample_rate"],"disposition":v["disposition"]
    })).collect()).unwrap_or_default()
}
#[cfg(test)] mod tests { use super::*;
    #[test] fn privacy_does_not_delete_rotation_or_language(){assert!(!sensitive("rotate"));assert!(!sensitive("language"));assert!(sensitive("location-eng"));}
    #[test] fn inventory_detects_missing_stream(){assert_ne!(inventory(&json!({"streams":[{"codec_type":"audio","codec_name":"aac"}]})),inventory(&json!({"streams":[]})));}
}
