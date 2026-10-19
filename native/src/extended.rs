//! ExifTool supplies broad format inspection and conservative XMP editing.
//! No user value becomes an executable, option name, config file, or shell code.
use crate::{model::*, tools};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path, fs::{self,File}, io::{Read,Write}};

pub fn fields() -> BTreeMap<&'static str, &'static str> {
    BTreeMap::from([("title","XMP-dc:Title"),("artist","XMP-dc:Creator"),
        ("description","XMP-dc:Description"),("copyright","XMP-dc:Rights"),
        ("keywords","XMP-dc:Subject"),("label","XMP-photoshop:Credit"),
        ("date","XMP-xmp:CreateDate"),("rating","XMP-xmp:Rating")])
}
fn text(value: &Value) -> String {
    match value { Value::String(s) => s.clone(), Value::Array(a) => a.iter().map(text).collect::<Vec<_>>().join("; "), Value::Null => String::new(), _ => value.to_string() }
}
fn base_args() -> Vec<String> {
    ["-config","","-charset","filename=UTF8","-api","LargeFileSupport=1"].iter().map(|s|s.to_string()).collect()
}
pub fn inspect(path: &Path, doc: &mut Inspection, editable: bool) -> Result<()> {
    doc.properties["adapter"] = json!("exiftool");
    doc.capabilities.writer = "File inventory".into();
    let mut args = base_args();
    args.extend(["-j","-G1","-s","-struct","-api","ImageHashType=SHA256","-ImageDataHash","-all"].iter().map(|s|s.to_string()));
    args.push(path.to_string_lossy().into_owned());
    let bytes = match tools::run("exiftool", &args, 120) {
        Ok(b) => b,
        Err(e) => { doc.warnings.push(format!("Extended metadata inspection is unavailable: {e}")); return Ok(()); }
    };
    let values: Value = serde_json::from_slice(&bytes)?;
    let tags = values.as_array().and_then(|a|a.first()).and_then(Value::as_object).context("ExifTool returned no file inventory")?;
    if let Some(err) = tags.get("ExifTool:Error") {
        doc.warnings.push(format!("Inspection only: {}", text(err)));
    }
    let map = fields();
    for (field, native) in &map {
        if let Some(v) = tags.get(*native) { doc.fields.insert(field.to_string(),if *field=="date"{date_text(&text(v))}else{text(v)}); }
    }
    let x3f=path.extension().and_then(|s|s.to_str()).map(|s|s.eq_ignore_ascii_case("x3f")).unwrap_or(false);
    let preview_xmp=x3f&&tags.keys().any(|k|k.ends_with(":JpgFromRaw"));
    let decoder_missing=tags.get("ExifTool:Warning").map(text).map(|s|s.contains("Install IO::Uncompress::Brotli")).unwrap_or(false);
    let read_only_extension=path.extension().and_then(|s|s.to_str()).map(|s|["3fr","dcr","kdc","srf"].contains(&s.to_ascii_lowercase().as_str())).unwrap_or(false);
    let writable = editable && !read_only_extension && !tags.contains_key("ExifTool:Error") && (!x3f||preview_xmp) && !decoder_missing;
    if x3f&&!preview_xmp {doc.warnings.push("This X3F variant has no writable JPEG preview. Its metadata is inspection-only.".into());}
    if decoder_missing {doc.warnings.push("This metadata engine cannot decode the compressed JXL metadata. Use the included Windows engine or an ExifTool build with Brotli support.".into());}
    for (name, value) in tags {
        if name == "SourceFile" { continue; }
        let (group, key) = name.split_once(':').unwrap_or(("File", name));
        let val = text(value);
        if group == "ExifTool" && key == "Warning" { doc.warnings.push(val.clone()); }
        doc.raw.push(RawField { namespace:group.into(),key:key.into(),value:val,writable:writable&&map.values().any(|v|*v==name) });
    }
    doc.properties["tag_family"] = json!("XMP-dc");
    if doc.kind=="other" {if let Some(mime)=tags.get("File:MIMEType").and_then(Value::as_str){
        doc.kind=if mime.starts_with("image/"){"image"}else if mime.starts_with("audio/"){"audio"}else if mime.starts_with("video/"){"video"}else if mime=="application/pdf"||mime.starts_with("application/vnd.")&&mime.contains("document"){"document"}else{"other"}.into();
    }}
    doc.properties["mime_type"] = tags.get("File:MIMEType").cloned().unwrap_or(Value::Null);
    doc.properties["image_width"] = tags.get("File:ImageWidth").or_else(||tags.get("IFD0:ImageWidth")).or_else(||tags.get("ExifIFD:ExifImageWidth")).cloned().unwrap_or(Value::Null);
    doc.properties["image_height"] = tags.get("File:ImageHeight").or_else(||tags.get("IFD0:ImageHeight")).or_else(||tags.get("ExifIFD:ExifImageHeight")).cloned().unwrap_or(Value::Null);
    doc.properties["orientation"] = tags.get("IFD0:Orientation").cloned().unwrap_or(Value::Null);
    doc.properties["cleanup_scope"] = json!("Known location, identity, time, descriptive EXIF/IPTC, XMP and C2PA/JUMBF tags. Camera calibration, embedded color profiles and orientation are retained. This is not the strict JPEG/PNG/WebP metadata strip.");
    if let Some(hash) = tags.get("File:ImageDataHash").and_then(Value::as_str).filter(|h|h.len()==64) {
        // The hash covers the format's main image payload. Render-critical tag
        // values are included separately; thumbnails and every private block are
        // outside this verification, as documented by ExifTool.
        let rendering:BTreeMap<_,_> = tags.iter().filter(|(k,_)| k.starts_with("ICC-") || ["IFD0:Orientation","IFD0:ImageWidth","IFD0:ImageHeight","IFD0:BitsPerSample","IFD0:PhotometricInterpretation","IFD0:SamplesPerPixel","File:ImageWidth","File:ImageHeight"].contains(&k.as_str())).collect();
        let bytes = serde_json::to_vec(&(hash, rendering))?;
        doc.properties["content_fingerprint"] = json!(blake3::hash(&bytes).to_hex().to_string());
    }
    if writable {
        doc.capabilities = Capabilities { fields:map.keys().map(|s|s.to_string()).collect(),artwork:false,raw_edit:true,
            policies:vec!["keep".into(),"privacy".into(),"clear_descriptive".into()],writer:"ExifTool · curated XMP fields".into() };
        if x3f {doc.capabilities.policies=vec!["keep".into()];doc.capabilities.writer="ExifTool · embedded preview XMP".into();doc.properties["cleanup_scope"]=json!("Only the embedded JPEG preview's XMP can be edited. X3F header and RAW properties are inspection-only.");}
        if doc.properties["content_fingerprint"].is_null() {
            doc.properties["copy_only"] = json!(true);
            doc.warnings.push("This format supports metadata readback, but no image-payload fingerprint. Edits are saved as copies; original replacement is unavailable.".into());
        }
    } else { doc.capabilities.writer = "ExifTool · inspection only".into(); }
    Ok(())
}
pub fn write(path: &Path, patch: &Patch) -> Result<Vec<String>> {
    if !matches!(patch.artwork,ArtworkEdit::Keep) || patch.policy==Policy::StripMetadata { bail!("This format supports descriptive metadata editing and scoped cleanup only"); }
    let wrapped=wrap_jxl(path)?;
    let mut args = base_args();
    args.extend(["-overwrite_original","-P","-sep","; "].iter().map(|s|s.to_string()));
    if patch.policy != Policy::Keep {
        args.extend(["-XMP:all=","-IPTC:all=","-EXIF:Artist=","-EXIF:Copyright=","-EXIF:ImageDescription=","-EXIF:UserComment=","-EXIF:XPTitle=","-EXIF:XPComment=","-EXIF:XPAuthor=","-EXIF:XPKeywords=","-EXIF:XPSubject="].iter().map(|s|s.to_string()));
    }
    if patch.policy == Policy::Privacy {
        args.extend(["-GPS:all=","-EXIF:CameraOwnerName=","-EXIF:BodySerialNumber=","-EXIF:LensSerialNumber=","-EXIF:Software=","-EXIF:ImageUniqueID=","-EXIF:DateTimeOriginal=","-EXIF:CreateDate=","-EXIF:ModifyDate=","-JUMBF:all="].iter().map(|s|s.to_string()));
    }
    let map = fields();
    for (key, value) in &patch.fields {
        let tag = map.get(key.as_str()).context("Unsupported extended-image field")?;
        let value=if key=="keywords"{value.as_deref().unwrap_or("").split(';').map(str::trim).filter(|s|!s.is_empty()).collect::<Vec<_>>().join("; ")}else{value.clone().unwrap_or_default()};
        args.push(format!("-{tag}={value}"));
    }
    for edit in &patch.raw {
        let tag = format!("{}:{}",edit.namespace,edit.key);
        if !map.values().any(|v|*v==tag) { bail!("This raw tag is inspection-only. Editable extended-image tags are the curated XMP fields."); }
        args.push(format!("-{tag}={}",edit.value.as_deref().unwrap_or("")));
    }
    args.push(path.to_string_lossy().into_owned());
    tools::run("exiftool", &args, 180)?;
    Ok(if wrapped {vec!["The JXL codestream was placed in a metadata-capable container without re-encoding its image data.".into()]} else {vec![]})
}

fn wrap_jxl(path:&Path)->Result<bool> {
    if !path.extension().and_then(|s|s.to_str()).map(|s|s.eq_ignore_ascii_case("jxl")).unwrap_or(false){return Ok(false);}
    let mut input=File::open(path)?;let size=input.metadata()?.len();let mut header=[0;2];if input.read(&mut header)?!=2||header!=[0xff,0x0a]{return Ok(false);}
    // ISO/IEC 18181 container: signature, ftyp, then one complete jxlc box.
    let mut temp=tempfile::NamedTempFile::new_in(path.parent().context("Missing image folder")?)?;
    temp.write_all(b"\x00\x00\x00\x0cJXL \x0d\x0a\x87\x0a\x00\x00\x00\x14ftypjxl \x00\x00\x00\x00jxl ")?;
    if size<=u32::MAX as u64-8 {temp.write_all(&((size+8) as u32).to_be_bytes())?;temp.write_all(b"jxlc")?;}
    else {temp.write_all(&1u32.to_be_bytes())?;temp.write_all(b"jxlc")?;temp.write_all(&(size+16).to_be_bytes())?;}
    temp.write_all(&header)?;std::io::copy(&mut input,&mut temp)?;temp.as_file().sync_all()?;drop(input);fs::copy(temp.path(),path)?;Ok(true)
}

pub fn date_text(value:&str)->String {
    let mut s=value.to_owned();
    if s.len()>=10 && s.is_char_boundary(10) && s.as_bytes()[..4].iter().all(u8::is_ascii_digit) {
        if s.as_bytes().get(4)==Some(&b':'){s.replace_range(4..5,"-");}
        if s.as_bytes().get(7)==Some(&b':'){s.replace_range(7..8,"-");}
        if s.as_bytes().get(10)==Some(&b' '){s.replace_range(10..11,"T");}
    }
    s
}
