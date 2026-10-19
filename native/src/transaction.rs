use crate::{audio, images, model::*, tools, video, formats, extended, documents};
use anyhow::{bail, Context, Result};
use serde_json::json;
use std::{collections::BTreeMap, fs::{self,File}, io::{Read,Write}, path::{Path,PathBuf}, time::{SystemTime,UNIX_EPOCH}};


fn path_text(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)] {
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") { return format!(r"\\{}", rest); }
        if let Some(rest) = value.strip_prefix(r"\\?\") { return rest.to_owned(); }
    }
    value.into_owned()
}

pub fn data_dir()->PathBuf { std::env::var_os("KI_DATA_DIR").map(PathBuf::from).unwrap_or_else(||std::env::temp_dir().join("ki-metadata-workbench")) }
pub fn hash(path:&Path)->Result<String> { let mut f=File::open(path)?;let mut h=blake3::Hasher::new();let mut b=[0;65536];loop{let n=f.read(&mut b)?;if n==0{break}h.update(&b[..n]);}Ok(h.finalize().to_hex().to_string()) }
fn extension(path:&Path)->String {path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase()}
fn regular(path:&Path)->Result<PathBuf> {let m=fs::symlink_metadata(path)?;if !m.is_file()||m.file_type().is_symlink(){bail!("Choose a regular file, not a symlink or directory")}Ok(fs::canonicalize(path)?)}
pub fn inspect(path:&Path)->Result<Inspection> {
    inspect_mode(path,false)
}
pub fn inventory(path:&Path)->Result<Inspection> {
    inspect_mode(path,true)
}
fn inspect_mode(path:&Path,tolerant:bool)->Result<Inspection> {
    let path=regular(path)?;let ext=extension(&path);let m=fs::metadata(&path)?;
    let kind=formats::kind(&ext);
    let evidence=crate::evidence::fingerprint(&path)?;
    let mut d=Inspection{path:path_text(&path),name:path.file_name().context("Missing filename")?.to_string_lossy().into_owned(),kind:kind.into(),format:if ext.is_empty(){"UNKNOWN".into()}else{ext.to_uppercase()},size:m.len(),etag:evidence["blake3"].as_str().context("Missing fingerprint")?.into(),fields:BTreeMap::new(),raw:vec![],artwork:vec![],properties:json!({}),warnings:vec![],capabilities:Capabilities::default()};
    let inspection=(||->Result<()> {match kind {
        "audio"=>audio::inspect(&path,&mut d)?,
        "image" if formats::IMAGES.contains(&ext.as_str())=>images::inspect(&path,&mut d)?,
        "image"=>extended::inspect(&path,&mut d,true)?,
        "video"=>video::inspect(&path,&mut d)?,
        "document"=>{let result=if ext=="pdf"{documents::inspect_pdf(&path,&mut d)}else{documents::inspect_package(&path,&mut d,formats::OPENDOCUMENT.contains(&ext.as_str()))};
            if let Err(e)=result {d.capabilities=Capabilities::default();d.capabilities.writer="Document inspection only".into();d.warnings.push(format!("Document properties could not be opened: {e}. Editing is unavailable."));}},
        _=>extended::inspect(&path,&mut d,false)?,
    };Ok(())})();
    if let Err(e)=inspection {if !tolerant{return Err(e);}d.capabilities=Capabilities::default();d.capabilities.writer="File inspection only".into();d.warnings.push(format!("Metadata parser stopped: {e}. File fingerprints remain available; editing is disabled."));}
    if evidence["extension_status"]=="mismatch" {d.capabilities=Capabilities::default();d.capabilities.writer="Signature mismatch — inspection only".into();d.properties["inspection_only"]=json!(true);d.warnings.push(format!("The .{} extension does not match the leading-byte signature ({}). Editing is disabled. The signature alone does not validate the file.",ext,evidence["detected_type"].as_str().unwrap_or("unknown")));}
    d.properties["evidence"]=evidence;
    if d.kind=="other" {d.properties["inspection_only"]=json!(true);d.raw.insert(0,RawField{namespace:"File".into(),key:"BLAKE3".into(),value:d.etag.clone(),writable:false});}
    if hash(&path)?!=d.etag{bail!("The file changed while it was being inspected. Reload it.")}
    Ok(d)
}
fn validate(p:&Patch)->Result<()> {
    if p.fields.len()>80||p.raw.len()>500{bail!("Patch exceeds the field limit")}
    for (key,val) in p.fields.iter().map(|(k,v)|(k,v)).chain(p.raw.iter().map(|v|(&v.key,&v.value))){
        if key.len()>256||key.contains('\0'){bail!("Invalid metadata key")}
        if let Some(v)=val {if v.len()>1024*1024||v.contains('\0'){bail!("Metadata values must be NUL-free and at most 1 MiB")}}
    }
    Ok(())
}
fn verification(before:&Path,after:&Path,doc:&Inspection,out:&Inspection,policy:&Policy,allow:bool)->Result<Verification>{
    let kind=doc.kind.as_str();let adapter=doc.properties["adapter"].as_str().unwrap_or("");
    let strict=kind=="image"&&*policy==Policy::StripMetadata;
    let (method,detail,hashes):(&str,&str,Result<(String,String)>)=match adapter {
        "pdf"=>("BLAKE3: reachable PDF document objects excluding properties", "PDF page, resource and other reachable document objects matched after excluding Info/XMP and storage bookkeeping. The file was rewritten without incremental metadata history.", documents::pdf_hash(before).and_then(|b|documents::pdf_hash(after).map(|a|(b,a)))),
        "ooxml"|"opendocument"=>{let odf=adapter=="opendocument";("BLAKE3: every non-metadata document package member", "Every non-metadata package member has the same name, length and uncompressed bytes. Document properties were rewritten; document content was preserved.", documents::package_hash(before,odf).and_then(|b|documents::package_hash(after,odf).map(|a|(b,a))))},
        "exiftool"=>{
            let b=doc.properties["content_fingerprint"].as_str();let a=out.properties["content_fingerprint"].as_str();
            if b.is_none()&&a.is_none(){return Ok(Verification{status:"metadata_only".into(),method:"Requested metadata readback".into(),before:None,after:None,detail:"Requested fields were reread successfully. This format has no qualified image-payload fingerprint, so the output is a copy and original replacement is disabled.".into()});}
            ("SHA-256 image payload + BLAKE3 rendering-tag inventory", "ExifTool's main image-data hash and inspected rendering tags matched. Embedded previews, thumbnails and every private container structure are outside this check.", b.zip(a).map(|(b,a)|(b.to_owned(),a.to_owned())).context("Image payload fingerprint disappeared during save"))
        },
        _ if strict=>("BLAKE3: complete image/animation container with the strict metadata removal rules applied", "Encoded image/animation data and retained rendering structures matched, without recompression. A complete output scan found no removable metadata blocks or trailing bytes. EXIF orientation and ICC profiles are excluded and removed.", images::privacy_payload_hash(before).and_then(|b|images::privacy_payload_hash(after).map(|a|(b,a)))),
        _ if kind=="image"=>("BLAKE3: image container excluding known descriptive blocks, plus orientation", "Protected image bytes and orientation matched; this is not a semantic audit of every metadata block.", images::payload_hash(before).and_then(|b|images::payload_hash(after).map(|a|(b,a)))),
        _=>("SHA-256: demuxed A/V packet payloads", "A/V compressed packet bytes matched. Timing, headers, other stream types and perceptual equivalence are outside this check.", tools::stream_hashes(before).and_then(|b|tools::stream_hashes(after).map(|a|(b,a))))
    };
    match hashes {
        Ok((b,a))=>{if a!=b {bail!("Media verification failed: protected content changed. No output was committed.")}
            Ok(Verification{status:"matched".into(),method:method.into(),before:Some(b),after:Some(a),detail:detail.into()})},
        Err(e)=>{if !allow||strict||!matches!(kind,"audio"|"video"){bail!("Verification unavailable: {e}. No output was committed.")}
            Ok(Verification{status:"unverified".into(),method:method.into(),before:None,after:None,detail:e.to_string()})}
    }
}
fn stamp()->String {format!("{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos())}
fn journal(result:&mut SaveResult)->Result<()> {
    let dir=data_dir().join("history");fs::create_dir_all(&dir)?;
    let destination=dir.join(format!("{}.json",stamp()));result.journal=Some(path_text(&destination));
    let mut persisted=result.clone();
    for art in persisted.before.artwork.iter_mut().chain(persisted.after.artwork.iter_mut()) { art.data_url=None; }
    if persisted.after.properties["privacy_verified"] == json!(true) || persisted.after.properties["cleanup_applied"] == json!(true) {
        // Preserve recovery fingerprints and counts without copying removed GPS,
        // employee names, prompts, or camera identifiers into persistent history.
        persisted.before.fields.clear(); persisted.before.raw.clear();
        persisted.before.warnings.clear(); persisted.before.properties=json!({}); persisted.before.artwork.clear();
    }
    let mut tmp=tempfile::NamedTempFile::new_in(&dir)?;serde_json::to_writer_pretty(&mut tmp,&persisted)?;tmp.flush()?;tmp.as_file().sync_all()?;tmp.persist_noclobber(&destination)?;Ok(())
}
pub fn save(request:SaveRequest)->Result<SaveResult> {
    validate(&request.patch)?;
    if request.replace_original&&request.allow_unverified{bail!("Unverified writes are copy-only. Disable replacement or enable verification.")}
    let source=regular(Path::new(&request.path))?;let before=inspect(&source)?;
    if request.replace_original && before.properties["copy_only"]==json!(true){bail!("This format supports copies only because no content fingerprint is available");}
    if before.etag!=request.expected_etag{bail!("The source changed since it was loaded. Reload before saving; your original was not modified.")}
    let policy=match request.patch.policy{Policy::Keep=>"keep",Policy::ClearDescriptive=>"clear_descriptive",Policy::Privacy=>"privacy",Policy::StripMetadata=>"strip_metadata"};
    if !before.capabilities.policies.iter().any(|p|p==policy){bail!("This cleanup policy is not supported for {}",before.format)}
    if request.patch.policy==Policy::StripMetadata&&(!request.patch.fields.is_empty()||!request.patch.raw.is_empty()||!matches!(request.patch.artwork,ArtworkEdit::Keep)) {
        bail!("Strip image metadata cannot be combined with field, raw-tag or artwork edits")
    }
    if before.kind=="video"&&!request.accept_remux{bail!("Acknowledge the video-remux warning before saving.")}
    for field in request.patch.fields.keys(){if !before.capabilities.fields.contains(field){bail!("Field {field} is not supported by this writer")}}
    let out=if request.replace_original{source.clone()}else{PathBuf::from(request.output.as_ref().context("A destination is required for Save Copy")?)};
    let parent=fs::canonicalize(out.parent().context("Missing destination folder")?)?;
    let destination=parent.join(out.file_name().context("Missing destination filename")?);
    if extension(&source)!=extension(&destination){bail!("Keep the original file extension. This editor does not transcode formats.")}
    if !request.replace_original&&(destination.exists()||destination==source){bail!("Save Copy never overwrites an existing file. Choose a new filename.")}
    let suffix=format!(".{}",extension(&source));
    let temp=tempfile::Builder::new().prefix(".ki-staging-").suffix(&suffix).tempfile_in(&parent)?;
    let staging=temp.into_temp_path();
    { let mut input=File::open(&source)?;let mut output=File::options().write(true).truncate(true).open(&staging)?;std::io::copy(&mut input,&mut output)?;output.sync_all()?; }
    let adapter=before.properties["adapter"].as_str().unwrap_or("");
    let mut warnings=match adapter {
        "pdf"=>documents::write_pdf(&staging,&request.patch)?,
        "ooxml"|"opendocument"=>documents::write_package(&staging,&request.patch,adapter=="opendocument")?,
        "exiftool"=>extended::write(&staging,&request.patch)?,
        _=>match before.kind.as_str(){"audio"=>audio::write(&staging,&request.patch)?,"image"=>images::write(&staging,&request.patch)?,"video"=>video::write(&source,&staging,&request.patch)?,_=>bail!("This file is inspection-only")},
    };
    File::options().write(true).open(&staging)?.sync_all()?;
    let mut after=inspect(&staging)?;
    if request.patch.policy==Policy::StripMetadata {
        images::verify_privacy(&staging)?;
        after.properties["privacy_verified"]=json!(true);
    }
    if after.capabilities.policies.is_empty() {bail!("The edited file could not be reinspected. No output committed.");}
    if request.patch.policy!=Policy::Keep {after.properties["cleanup_applied"]=json!(true);}
    if request.patch.policy!=Policy::Keep && matches!(adapter,"pdf"|"ooxml"|"opendocument") {
        let added=request.patch.fields.values().filter(|v|v.as_deref().map(|s|!s.is_empty()).unwrap_or(false)).count();
        if after.raw.len()>added || after.fields.keys().any(|k|!request.patch.fields.contains_key(k)) || after.properties["metadata_streams"].as_u64().unwrap_or(0)>0 {bail!("Document-property cleanup failed readback. No output committed.");}
        after.properties["document_properties_cleared"]=json!(true);
    }
    if request.patch.policy==Policy::Privacy && adapter=="exiftool" && after.raw.iter().any(|r| matches!(r.namespace.as_str(),"GPS"|"JUMBF"|"IPTC")) {bail!("Known private metadata remains after cleanup. No output committed.");}
    // Read-back is required. Do not silently report success when a format discards a field.
    for (field,value) in &request.patch.fields {
        let normalized=value.as_ref().map(|v|if field=="keywords" && (before.kind=="image") {v.split(';').map(str::trim).filter(|s|!s.is_empty()).collect::<Vec<_>>().join("; ")}else if field=="date"&&adapter=="exiftool"{extended::date_text(v)}else{v.clone()});
        let expected=normalized.as_deref().filter(|s|!s.is_empty());let actual=after.fields.get(field).map(String::as_str).filter(|s|!s.is_empty());
        if expected!=actual{bail!("Read-back check failed for {field}: requested {:?}, found {:?}. No output committed.",expected,actual)}
    }
    for edit in &request.patch.raw {
        let actual=after.raw.iter().find(|r|r.namespace==edit.namespace&&r.key==edit.key).map(|r|r.value.as_str());
        if actual.filter(|s|!s.is_empty())!=edit.value.as_deref().filter(|s|!s.is_empty()) {bail!("Raw-field read-back failed for {} / {}",edit.namespace,edit.key)}
    }
    match &request.patch.artwork {ArtworkEdit::Remove=>if !after.artwork.is_empty(){bail!("Artwork removal failed read-back")},ArtworkEdit::Replace{..}=>if after.artwork.len()!=1{bail!("Artwork replacement failed read-back")},_=>{}}
    let check=verification(&source,&staging,&before,&after,&request.patch.policy,request.allow_unverified)?;
    if hash(&source)?!=before.etag{bail!("The source changed during processing. Nothing was replaced.")}
    let backup=if request.replace_original {
        let dir=source.parent().context("Missing source folder")?.join(".ki-backups");fs::create_dir_all(&dir)?;
        let name=format!("{}-{}",stamp(),before.name);let path=dir.join(name);
        let mut file=File::options().write(true).create_new(true).open(&path)?;let mut original=File::open(&source)?;std::io::copy(&mut original,&mut file)?;file.sync_all()?;
        if hash(&path)?!=before.etag{bail!("Backup verification failed. Original remains unchanged.")}
        Some(path_text(&path))
    }else{None};
    if hash(&source)?!=before.etag{bail!("Source changed immediately before commit; nothing replaced.")}
    fs::set_permissions(&staging,fs::metadata(&source)?.permissions())?;
    if request.replace_original{staging.persist(&destination)?;}else{staging.persist_noclobber(&destination)?;}
    after.path=path_text(&destination);after.name=destination.file_name().unwrap_or_default().to_string_lossy().into_owned();
    for r in &mut after.raw {if r.namespace=="System" {if r.key=="FileName"{r.value=after.name.clone();}else if r.key=="Directory"{r.value=path_text(&parent);}}}
    warnings.extend(after.warnings.clone());
    let mut result=SaveResult{saved_at_ms:Some(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64),output:after.path.clone(),backup,journal:None,verification:check,before,after,warnings};
    if let Err(e)=journal(&mut result){result.journal=None;result.warnings.push(format!("File saved, but audit journal could not be written: {e}"));}
    Ok(result)
}
pub fn history()->Result<Vec<SaveResult>> {
    let dir=data_dir().join("history");if !dir.exists(){return Ok(vec![])}
    let mut paths:Vec<_>=fs::read_dir(dir)?.filter_map(|e|e.ok().map(|e|e.path())).filter(|p|extension(p)=="json").collect();paths.sort();paths.reverse();
    let mut rows=Vec::new();let mut total=0usize;for p in paths.into_iter().take(50){
        if fs::metadata(&p).map(|m|m.len()>8*1024*1024).unwrap_or(true){continue}
        if let Ok(d)=fs::read(p){if total+d.len()>8*1024*1024{break}if let Ok(r)=serde_json::from_slice::<SaveResult>(&d){total+=d.len();rows.push(r)}}
    }Ok(rows)
}
pub fn restore(journal_path:&Path)->Result<Inspection>{
    let path=regular(journal_path)?;let root=fs::canonicalize(data_dir().join("history"))?;
    if path.parent()!=Some(root.as_path()){bail!("Restore requires a journal from this application's history")}
    let record:SaveResult=serde_json::from_slice(&fs::read(path)?)?;
    let backup=regular(Path::new(record.backup.as_ref().context("This save did not replace an original; there is no original backup to restore")?))?;
    let target=regular(Path::new(&record.output))?;
    if hash(&backup)?!=record.before.etag{bail!("Backup has changed; restoration blocked")}
    if hash(&target)?!=record.after.etag{bail!("The current file has newer changes. Restore is blocked to protect them.")}
    let current=inspect(&target)?;
    let recovery=target.parent().context("Missing parent")?.join(".ki-backups").join(format!("{}-before-restore-{}",stamp(),current.name));
    fs::copy(&target,&recovery)?;File::options().write(true).open(&recovery)?.sync_all()?;
    if hash(&recovery)?!=current.etag{bail!("Pre-restore backup verification failed")}
    let temp=tempfile::NamedTempFile::new_in(target.parent().unwrap())?.into_temp_path();fs::copy(&backup,&temp)?;File::options().write(true).open(&temp)?.sync_all()?;
    if hash(&target)?!=current.etag{bail!("Current file changed while restoring")}
    temp.persist(&target)?;let after=inspect(&target)?;
    let mut restored=SaveResult{saved_at_ms:Some(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64),output:after.path.clone(),backup:Some(path_text(&recovery)),journal:None,
        verification:Verification{status:"matched".into(),method:"BLAKE3: complete restored file equals saved original".into(),before:Some(record.before.etag.clone()),after:Some(after.etag.clone()),detail:"Restoration is not a metadata-only operation; it restores the complete backup.".into()},before:current,after:after.clone(),warnings:vec![]};
    journal(&mut restored)?;Ok(after)
}
pub fn export_artwork(path:&Path,index:usize,output:&Path)->Result<()> {
    let bytes=audio::artwork_bytes(path,index)?;let mut f=File::options().create_new(true).write(true).open(output)?;f.write_all(&bytes)?;f.sync_all()?;Ok(())
}
#[cfg(test)] mod tests {use super::*;
    #[test] fn rejects_nul(){let mut p=Patch::default();p.fields.insert("title".into(),Some("a\0b".into()));assert!(validate(&p).is_err());}
    #[test] fn hash_detects_byte_changes(){let d=tempfile::tempdir().unwrap();let p=d.path().join("f");fs::write(&p,b"a").unwrap();let a=hash(&p).unwrap();fs::write(&p,b"b").unwrap();assert_ne!(a,hash(&p).unwrap());}
    #[test] fn unknown_files_are_inspect_only(){let d=tempfile::tempdir().unwrap();let p=d.path().join("f.exe");fs::write(&p,b"a").unwrap();assert!(inspect(&p).unwrap().capabilities.policies.is_empty());}
}
