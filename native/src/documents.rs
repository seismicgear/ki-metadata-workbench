//! Document properties only: PDF Info/XMP and Office/OpenDocument package metadata.
//! Saves rewrite the container and verify the protected document payload.
use crate::{model::*, xmp};
use anyhow::{bail, Context, Result};
use lopdf::{dictionary, Dictionary, Document, Object, Stream};
use quick_xml::{events::Event, Reader};
use serde_json::json;
use std::{collections::{BTreeMap, BTreeSet}, fs::{self, File}, io::{Read, Write}, path::Path};
use xmltree::{Element, Namespace, XMLNode};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

const MAX_FILE: u64 = 512 * 1024 * 1024;
const MAX_XML: u64 = 8 * 1024 * 1024;
const DC: &str = "http://purl.org/dc/elements/1.1/";
const CP: &str = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const EP: &str = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
const OFFICE: &str = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const META: &str = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0";
const SCOPE: &str = "Document properties only. Text, comments, tracked changes, speaker notes, formulas, attachments and embedded media retain their contents and may contain personal information.";

fn sized(path: &Path) -> Result<()> { if fs::metadata(path)?.len()>MAX_FILE { bail!("Document editing is limited to 512 MiB per file"); } Ok(()) }
fn caps(keys: impl Iterator<Item=String>, writer:&str) -> Capabilities {
    Capabilities { fields:keys.collect(),artwork:false,raw_edit:false,policies:vec!["keep".into(),"privacy".into(),"clear_descriptive".into()],writer:writer.into() }
}
fn xml(bytes: &[u8]) -> Result<Element> {
    if bytes.len()>MAX_XML as usize { bail!("Document properties exceed 8 MiB"); }
    let mut reader=Reader::from_reader(bytes); let mut depth=0usize;
    loop { match reader.read_event()? {
        Event::Start(_)=>{depth+=1;if depth>64 {bail!("Document properties exceed 64 XML levels");}},
        Event::End(_)=>{depth=depth.checked_sub(1).context("Unbalanced property XML")?;},
        Event::DocType(_)=>bail!("DTD-bearing document properties cannot be edited"),
        Event::Eof=>{if depth!=0 {bail!("Unbalanced property XML");}break}, _=>()
    }}
    Element::parse(bytes).context("Invalid document property XML")
}
fn xml_bytes(e:&Element)->Result<Vec<u8>> {let mut b=vec![];e.write(&mut b)?;xml(&b)?;Ok(b)}
fn child_text(e:&Element)->String {e.get_text().map(|s|s.into_owned()).unwrap_or_default()}
fn node(prefix:&str,name:&str,uri:&str,value:&str)->XMLNode {
    let mut e=Element::new(name);e.prefix=Some(prefix.into());e.namespace=Some(uri.into());
    let mut ns=Namespace::empty();ns.put(prefix,uri);e.namespaces=Some(ns);
    e.children.push(XMLNode::Text(value.into()));XMLNode::Element(e)
}
fn set_node(root:&mut Element,uri:&str,name:&str,prefix:&str,value:&Option<String>) {
    root.children.retain(|n|!matches!(n,XMLNode::Element(e) if e.namespace.as_deref()==Some(uri)&&e.name==name));
    if let Some(v)=value.as_deref().filter(|s|!s.is_empty()) {root.children.push(node(prefix,name,uri,v));}
}
fn package_map(odf:bool)->BTreeMap<&'static str,(&'static str,&'static str,&'static str,&'static str)> {
    if odf { BTreeMap::from([
        ("title",("meta.xml",DC,"title","dc")),("artist",("meta.xml",DC,"creator","dc")),
        ("description",("meta.xml",DC,"description","dc")),("subject",("meta.xml",DC,"subject","dc")),
        ("language",("meta.xml",DC,"language","dc")),("keywords",("meta.xml",META,"keyword","meta")),
        ("initial_creator",("meta.xml",META,"initial-creator","meta"))])
    } else { BTreeMap::from([
        ("title",("docProps/core.xml",DC,"title","dc")),("artist",("docProps/core.xml",DC,"creator","dc")),
        ("description",("docProps/core.xml",DC,"description","dc")),("subject",("docProps/core.xml",DC,"subject","dc")),
        ("language",("docProps/core.xml",DC,"language","dc")),("keywords",("docProps/core.xml",CP,"keywords","cp")),
        ("category",("docProps/core.xml",CP,"category","cp")),("last_modified_by",("docProps/core.xml",CP,"lastModifiedBy","cp")),
        ("company",("docProps/app.xml",EP,"Company","ep")),("manager",("docProps/app.xml",EP,"Manager","ep"))]) }
}
fn metadata_part(name:&str,odf:bool)->bool { if odf {name=="meta.xml"} else {matches!(name,"docProps/core.xml"|"docProps/app.xml"|"docProps/custom.xml")} }
fn open_zip(path:&Path)->Result<ZipArchive<File>> { sized(path)?; let z=ZipArchive::new(File::open(path)?)?;if z.len()>20000 {bail!("Document package exceeds 20,000 entries");}Ok(z) }
fn check_zip(z:&mut ZipArchive<File>,odf:bool)->Result<Option<String>> {
    let mut names=BTreeSet::new();let mut total=0u64;let mut restricted=None;
    for i in 0..z.len() {let f=z.by_index(i)?;let name=f.name();
        if !names.insert(name.to_owned()) {bail!("Duplicate package entry: {name}");}
        if f.enclosed_name().is_none() || name.contains('\\') {bail!("Invalid package member path");}
        total=total.checked_add(f.size()).context("Package size overflow")?;
        if total>2*1024*1024*1024 {bail!("Expanded document exceeds 2 GiB");}
        if name.starts_with("_xmlsignatures/") || (name.starts_with("META-INF/") && name.to_ascii_lowercase().contains("signature")) {restricted=Some("Digitally signed documents are inspection-only to preserve their signatures.".into());}
    }
    let required=if odf {"mimetype"} else {"[Content_Types].xml"};
    if !names.contains(required) {bail!("File is not the expected document package");}
    if !odf {let root=xml(&read_part(z,"[Content_Types].xml")?)?;if root.children.iter().any(|n|matches!(n,XMLNode::Element(e) if e.attributes.get("ContentType").map(|v|v.contains("digital-signature")).unwrap_or(false))){restricted=Some("Digitally signed documents are inspection-only to preserve their signatures.".into());}}
    if odf {if let Ok(bytes)=read_part(z,"META-INF/manifest.xml") {let e=xml(&bytes)?;fn encrypted(e:&Element)->bool {e.name=="encryption-data"||e.children.iter().any(|c|matches!(c,XMLNode::Element(e) if encrypted(e)))}if encrypted(&e){restricted=Some("Encrypted documents are inspection-only.".into());}}}
    Ok(restricted)
}
fn read_part(z:&mut ZipArchive<File>,name:&str)->Result<Vec<u8>> {let f=z.by_name(name)?;if f.size()>MAX_XML {bail!("Document property part exceeds 8 MiB");}let mut b=vec![];f.take(MAX_XML+1).read_to_end(&mut b)?;if b.len()>MAX_XML as usize{bail!("Expanded properties exceed 8 MiB");}Ok(b)}
fn property_root(root:&Element,odf:bool)->Option<&Element> {if odf {root.children.iter().find_map(|n|match n {XMLNode::Element(e) if e.name=="meta"&&e.namespace.as_deref()==Some(OFFICE)=>Some(e),_=>None})}else{Some(root)}}
fn property_root_mut(root:&mut Element,odf:bool)->Result<&mut Element> {if odf {root.children.iter_mut().find_map(|n|match n{XMLNode::Element(e) if e.name=="meta"&&e.namespace.as_deref()==Some(OFFICE)=>Some(e),_=>None}).context("OpenDocument has no office:meta element")}else{Ok(root)}}
fn raw_xml(e:&Element,namespace:&str,out:&mut Vec<RawField>) {
    for child in &e.children {if let XMLNode::Element(c)=child {let value=child_text(c);if !value.is_empty() {out.push(RawField {namespace:namespace.into(),key:format!("{}{}",c.prefix.as_ref().map(|p|format!("{p}:")).unwrap_or_default(),c.name),value,writable:false});} else {raw_xml(c,namespace,out);}}}
}
pub fn inspect_package(path:&Path,doc:&mut Inspection,odf:bool)->Result<()> {
    let mut z=open_zip(path)?;let restricted=check_zip(&mut z,odf)?;
    let map=package_map(odf);let mut roots=BTreeMap::new();
    let names:Vec<String>=(0..z.len()).map(|i|z.by_index(i).map(|f|f.name().to_owned())).collect::<std::result::Result<_,_>>()?;
    for name in names.iter().filter(|n|metadata_part(n,odf)) {let bytes=read_part(&mut z,name)?;roots.insert(name.clone(),xml(&bytes)?);}
    for (key,(part,uri,name,_)) in &map {if let Some(root)=roots.get(*part).and_then(|r|property_root(r,odf)) {
        let vals:Vec<_>=root.children.iter().filter_map(|n|match n{XMLNode::Element(e) if e.name==*name&&e.namespace.as_deref()==Some(*uri)=>Some(child_text(e)),_=>None}).filter(|s|!s.is_empty()).collect();
        if !vals.is_empty(){doc.fields.insert(key.to_string(),vals.join("; "));}
    }}
    for (name,root) in &roots {raw_xml(root,name,&mut doc.raw);}
    doc.properties=json!({"adapter":if odf{"opendocument"}else{"ooxml"},"package_entries":z.len(),"metadata_parts":roots.keys().collect::<Vec<_>>(),"cleanup_scope":SCOPE,"privacy_clears":map.keys().collect::<Vec<_>>()});
    // Creating an absent property part also requires relationship/content-type
    // maintenance. Only present, declared parts are editable in this version.
    let keys=map.iter().filter(|(_, (part,_,_,_))|roots.contains_key(*part)).map(|(k,_)|k.to_string());
    doc.capabilities=caps(keys,if odf{"Rust · OpenDocument properties"}else{"Rust · Office document properties"});
    if roots.is_empty(){doc.warnings.push("No editable property part is present. The package is available for inspection.".into());doc.capabilities.policies.clear();}
    if let Some(reason)=restricted {doc.warnings.push(reason);doc.capabilities.fields.clear();doc.capabilities.policies.clear();}
    doc.warnings.push(SCOPE.into());Ok(())
}
pub fn write_package(path:&Path,patch:&Patch,odf:bool)->Result<Vec<String>> {
    if !patch.raw.is_empty() || !matches!(patch.artwork,ArtworkEdit::Keep) {bail!("Document properties do not support raw or artwork edits");}
    let mut z=open_zip(path)?;if let Some(reason)=check_zip(&mut z,odf)?{bail!(reason)}
    let map=package_map(odf);let mut changes=BTreeMap::<String,Vec<u8>>::new();
    let names:Vec<String>=(0..z.len()).map(|i|z.by_index(i).map(|f|f.name().to_owned())).collect::<std::result::Result<_,_>>()?;
    for name in names.iter().filter(|n|metadata_part(n,odf)) {
        let mut root=xml(&read_part(&mut z,name)?)?;
        let props=property_root_mut(&mut root,odf)?;
        if patch.policy!=Policy::Keep {props.children.clear();props.attributes.clear();}
        for (key,value) in &patch.fields {let (part,uri,local,prefix)=map.get(key.as_str()).context("Unsupported document field")?;if name==part {set_node(props,uri,local,prefix,value);}}
        changes.insert(name.clone(),xml_bytes(&root)?);
    }
    let temp=tempfile::NamedTempFile::new_in(path.parent().context("Missing document folder")?)?;
    let mut output=ZipWriter::new(temp.reopen()?);
    if patch.policy==Policy::Keep {output.set_raw_comment(z.comment().to_vec().into());}
    for i in 0..z.len() {let f=z.by_index(i)?;
        if let Some(bytes)=changes.get(f.name()) {
            let options=SimpleFileOptions::default().compression_method(f.compression()).last_modified_time(f.last_modified().unwrap_or_default()).unix_permissions(f.unix_mode().unwrap_or(0o644));
            output.start_file(f.name(),options)?;output.write_all(bytes)?;
        } else {output.raw_copy_file(f)?;}
    }
    output.finish()?.sync_all()?;drop(z);
    fs::copy(temp.path(),path)?;
    Ok(vec![])
}
pub fn package_hash(path:&Path,odf:bool)->Result<String> {
    let mut z=open_zip(path)?;check_zip(&mut z,odf)?;let mut parts=BTreeMap::new();
    for i in 0..z.len() {let mut f=z.by_index(i)?;let name=f.name().to_owned();if metadata_part(&name,odf){continue;}
        let mut h=blake3::Hasher::new();let mut buf=[0;65536];let mut seen=0u64;
        loop {let n=f.read(&mut buf)?;if n==0{break;}seen+=n as u64;if seen>2*1024*1024*1024{bail!("Expanded document member exceeds the limit");}h.update(&buf[..n]);}
        parts.insert(name,(seen,h.finalize().to_hex().to_string()));
    }
    Ok(blake3::hash(&serde_json::to_vec(&parts)?).to_hex().to_string())
}

fn pdf_map()->BTreeMap<&'static str,&'static str> {BTreeMap::from([("title","Title"),("artist","Author"),("description","Subject"),("keywords","Keywords"),("software","Creator"),("producer","Producer")])}
fn load_pdf(path:&Path)->Result<Document> {sized(path)?;let options=lopdf::LoadOptions {max_decompressed_size:Some(32*1024*1024),..Default::default()};Ok(Document::load_with_options(path,options)?)}
fn pdf_info(d:&Document)->Option<&Dictionary> {let o=d.trailer.get(b"Info").ok()?;match o {Object::Reference(id)=>d.get_object(*id).ok()?.as_dict().ok(),_=>o.as_dict().ok()}}
fn signed(d:&Document)->bool {
    fn visit(o:&Object,depth:usize)->bool {if depth>128{return true;}match o {
        Object::Dictionary(v)=>v.has(b"ByteRange")||v.get(b"Type").and_then(Object::as_name).ok()==Some(b"Sig")||v.iter().any(|(_,o)|visit(o,depth+1)),
        Object::Array(a)=>a.iter().any(|o|visit(o,depth+1)),Object::Stream(s)=>visit(&Object::Dictionary(s.dict.clone()),depth+1),_=>false
    }}d.objects.values().any(|o|visit(o,0))
}
fn metadata_xml(d:&Document)->Option<String> {let obj=d.catalog().ok()?.get(b"Metadata").ok()?;let o=match obj{Object::Reference(id)=>d.get_object(*id).ok()?,_=>obj};let stream=o.as_stream().ok()?;let b=stream.get_plain_content_with_limit(MAX_XML as usize).ok()?;if b.len()>MAX_XML as usize{return None;}String::from_utf8(b).ok()}
pub fn inspect_pdf(path:&Path,doc:&mut Inspection)->Result<()> {
    let d=load_pdf(path)?;let map=pdf_map();
    if let Some(info)=pdf_info(&d) {for (key,value) in info {
        let value=lopdf::decode_text_string(value).unwrap_or_else(|_|format!("{value:?}"));
        doc.raw.push(RawField {namespace:"PDF Info".into(),key:String::from_utf8_lossy(key).into_owned(),value:value.clone(),writable:false});
        for (field,native) in &map {if key.as_slice()==native.as_bytes(){doc.fields.insert(field.to_string(),value.clone());}}
    }}
    if let Some(packet)=metadata_xml(&d) {match xmp::read(&packet){Ok(values)=>for (key,value) in values {doc.raw.push(RawField {namespace:"PDF XMP".into(),key,value,writable:false});},Err(e)=>doc.warnings.push(format!("XMP packet: {e}"))}}
    let metadata_count=d.objects.values().filter(|o|o.as_stream().map(|s|s.dict.get(b"Type").and_then(Object::as_name).ok()==Some(b"Metadata")).unwrap_or(false)).count();
    doc.properties=json!({"adapter":"pdf","pages":d.get_pages().len(),"pdf_version":d.version,"metadata_streams":metadata_count,"cleanup_scope":SCOPE,"privacy_clears":map.keys().collect::<Vec<_>>()});
    doc.capabilities=caps(map.keys().map(|k|k.to_string()),"Rust · PDF properties");
    if d.was_encrypted()||d.is_encrypted()||signed(&d) {doc.capabilities.fields.clear();doc.capabilities.policies.clear();doc.warnings.push("Encrypted or digitally signed PDFs are inspection-only.".into());}
    doc.warnings.push(SCOPE.into());Ok(())
}
fn strip_refs(o:&mut Object,depth:usize)->Result<()> {
    if depth>128 {bail!("PDF object nesting exceeds 128 levels");}
    match o {Object::Dictionary(d)=>{d.remove(b"Metadata");for (_,v) in d.iter_mut(){strip_refs(v,depth+1)?;}},Object::Stream(s)=>{s.dict.remove(b"Metadata");for (_,v) in s.dict.iter_mut(){strip_refs(v,depth+1)?;}},Object::Array(a)=>for v in a {strip_refs(v,depth+1)?;},_=>()};Ok(())
}
fn remove_pdf_metadata(d:&mut Document)->Result<()> {
    d.trailer.remove(b"Info");d.trailer.remove(b"ID");
    for o in d.objects.values_mut(){strip_refs(o,0)?;}
    d.objects.retain(|_,o|!o.as_stream().map(|s|matches!(s.dict.get(b"Type").and_then(Object::as_name).ok(),Some(b"Metadata"|b"ObjStm"|b"XRef"))).unwrap_or(false));
    d.prune_objects();Ok(())
}
pub fn write_pdf(path:&Path,patch:&Patch)->Result<Vec<String>> {
    if !patch.raw.is_empty()||!matches!(patch.artwork,ArtworkEdit::Keep){bail!("PDF supports document-property fields only");}
    let mut d=load_pdf(path)?;if d.was_encrypted()||d.is_encrypted()||signed(&d){bail!("Encrypted or signed PDFs cannot be edited");}
    let previous_xmp=metadata_xml(&d);
    if patch.policy==Policy::Keep && d.catalog()?.has(b"Metadata") && previous_xmp.is_none(){bail!("The existing XMP could not be read safely. Choose Clear descriptive or Privacy cleanup to replace the document properties.");}
    let mut info=if patch.policy==Policy::Keep{pdf_info(&d).cloned().unwrap_or_default()}else{Dictionary::new()};
    if patch.policy!=Policy::Keep{remove_pdf_metadata(&mut d)?;}
    let map=pdf_map();
    for (field,value) in &patch.fields {let key=map.get(field.as_str()).context("Unsupported PDF field")?;info.remove(key.as_bytes());if let Some(v)=value.as_deref().filter(|s|!s.is_empty()){info.set(*key,lopdf::text_string(v));}}
    // Replace the existing Info object in place to avoid keeping old values in
    // an unreachable object. A normal full save removes incremental revisions.
    if let Ok(id)=d.trailer.get(b"Info").and_then(Object::as_reference) {d.objects.insert(id,Object::Dictionary(info));}
    else if !info.is_empty(){let id=d.add_object(info);d.trailer.set("Info",Object::Reference(id));}
    if patch.policy==Policy::Keep && previous_xmp.is_some() {
        let mut updates:BTreeMap<_,_>=patch.fields.iter().filter(|(k,_)|xmp::fields().contains(k)||matches!(k.as_str(),"software"|"producer")).map(|(k,v)|(k.clone(),v.clone())).collect();
        if let Some(value)=patch.fields.get("keywords"){updates.insert("pdf_keywords".into(),value.clone());}
        let packet=xmp::patch(previous_xmp.as_deref(),&updates,&BTreeMap::new())?;
        if let Ok(id)=d.catalog()?.get(b"Metadata").and_then(Object::as_reference) {d.objects.insert(id,Object::Stream(Stream::new(dictionary! {"Type"=>"Metadata","Subtype"=>"XML"},packet.into_bytes())));}
    }
    d.objects.retain(|_,o|!o.as_stream().map(|s|matches!(s.dict.get(b"Type").and_then(Object::as_name).ok(),Some(b"ObjStm"|b"XRef"))).unwrap_or(false));
    d.prune_objects();d.save(path)?;Ok(vec![])
}
fn canonical(o:&Object,h:&mut blake3::Hasher,depth:usize)->Result<()> {
    if depth>128 {bail!("PDF verification depth exceeded");}
    fn bytes(h:&mut blake3::Hasher,tag:u8,b:&[u8]){h.update(&[tag]);h.update(&(b.len() as u64).to_le_bytes());h.update(b);}
    match o {
        Object::Null=>{h.update(b"z");},Object::Boolean(v)=>{h.update(if *v{b"t"}else{b"f"});},
        Object::Integer(v)=>bytes(h,b'n',v.to_string().as_bytes()),Object::Real(v)=>bytes(h,b'n',v.to_string().as_bytes()),
        Object::Name(v)=>bytes(h,b'k',v),Object::String(v,_)=>bytes(h,b's',v),
        Object::Reference((id,gen))=>bytes(h,b'r',format!("{id}:{gen}").as_bytes()),
        Object::Array(a)=>{h.update(b"[");h.update(&(a.len() as u64).to_le_bytes());for v in a{canonical(v,h,depth+1)?;}h.update(b"]");},
        Object::Dictionary(d)=>{h.update(b"{");let sorted:BTreeMap<_,_>=d.iter().collect();for (k,v) in sorted{bytes(h,b'k',k);canonical(v,h,depth+1)?;}h.update(b"}");},
        Object::Stream(s)=>{let mut d=s.dict.clone();d.remove(b"Length");canonical(&Object::Dictionary(d),h,depth+1)?;bytes(h,b'b',&s.content);}
    };Ok(())
}
pub fn pdf_hash(path:&Path)->Result<String> {
    let mut d=load_pdf(path)?;remove_pdf_metadata(&mut d)?;let mut h=blake3::Hasher::new();
    canonical(d.trailer.get(b"Root")?,&mut h,0)?;
    for (id,o) in &d.objects {h.update(&id.0.to_le_bytes());h.update(&id.1.to_le_bytes());canonical(o,&mut h,0)?;}
    Ok(h.finalize().to_hex().to_string())
}
