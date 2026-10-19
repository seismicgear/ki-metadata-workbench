//! Preserve unknown XMP bytes. Only explicitly edited RDF child properties are
//! replaced. Attribute-form edits are rejected rather than silently duplicated.
use anyhow::{bail, Context, Result};
use quick_xml::{events::Event, Reader};
use std::collections::{BTreeMap, HashMap};
use xmltree::{Element, XMLNode};

const DC: &str = "http://purl.org/dc/elements/1.1/";
const RDF: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XMP: &str = "http://ns.adobe.com/xap/1.0/";
const PS: &str = "http://ns.adobe.com/photoshop/1.0/";
const PDF: &str = "http://ns.adobe.com/pdf/1.3/";
const KI: &str = "https://kuykendall.industries/ns/metadata/1.0/";
const EMPTY: &str = "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"></rdf:RDF></x:xmpmeta>";
fn mapping(field: &str) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match field {
        "title" => (DC, "title", "alt"), "artist" => (DC, "creator", "seq"),
        "description" => (DC, "description", "alt"), "copyright" => (DC, "rights", "alt"),
        "keywords" => (DC, "subject", "bag"), "date" => (XMP, "CreateDate", "text"),
        "label" => (PS, "Credit", "text"), "software" => (XMP,"CreatorTool","text"), "producer" => (PDF,"Producer","text"), "pdf_keywords" => (PDF,"Keywords","text"), _ => return None,
    })
}
pub fn fields() -> Vec<String> {
    ["title", "artist", "description", "copyright", "keywords", "date", "label"].iter().map(|s| s.to_string()).collect()
}
pub fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}
fn validate(xml: &str) -> Result<()> {
    if xml.len() > 2 * 1024 * 1024 { bail!("XMP packet exceeds 2 MiB"); }
    if xml.to_ascii_uppercase().contains("<!DOCTYPE") { bail!("DTD-bearing XMP is not accepted"); }
    // Check depth before xmltree allocates a recursive tree. Malformed/deep
    // metadata must remain removable without exhausting the native process.
    let mut reader = Reader::from_str(xml);
    let mut depth = 0usize;
    loop {
        match reader.read_event().context("Malformed XMP event")? {
            Event::Start(_) => { depth += 1; if depth > 64 { bail!("XMP nesting exceeds 64 levels"); } }
            Event::End(_) => { depth = depth.checked_sub(1).context("Unbalanced XMP")?; }
            Event::DocType(_) => bail!("DTD-bearing XMP is not accepted"),
            Event::Eof => { if depth != 0 { bail!("Unbalanced XMP"); } break; }
            _ => (),
        }
    }
    Ok(())
}
fn node_text(element: &Element) -> Vec<String> {
    let mut result = Vec::new();
    for child in &element.children {
        match child {
            XMLNode::Text(s) | XMLNode::CData(s) if !s.trim().is_empty() => result.push(s.to_owned()),
            XMLNode::Element(e) => result.extend(node_text(e)), _ => (),
        }
    }
    result
}
pub fn read(xml: &str) -> Result<BTreeMap<String, String>> {
    validate(xml)?;
    let root = Element::parse(xml.as_bytes()).context("Malformed XMP")?;
    let mut values = BTreeMap::new();
    fn walk(e: &Element, result: &mut BTreeMap<String, String>) {
        for field in fields() {
            let (uri, local, _) = mapping(&field).unwrap();
            if e.name == local && e.namespace.as_deref() == Some(uri) {
                let texts = node_text(e);
                if !texts.is_empty() { result.entry(field).or_insert_with(|| texts.join("; ")); }
            }
        }
        for child in &e.children { if let XMLNode::Element(c) = child { walk(c, result); } }
    }
    walk(&root, &mut values);
    Ok(values)
}
#[derive(Clone)]
struct Node { uri: String, local: String, namespaces: HashMap<String, String> }
fn expanded(name: &[u8], namespaces: &HashMap<String, String>) -> (String, String) {
    let text = String::from_utf8_lossy(name);
    let (prefix, local) = text.split_once(':').unwrap_or(("", text.as_ref()));
    (namespaces.get(prefix).cloned().unwrap_or_default(), local.to_string())
}
pub fn patch(source: Option<&str>, changes: &BTreeMap<String, Option<String>>, custom: &BTreeMap<String, Option<String>>) -> Result<String> {
    let source = source.filter(|s| !s.trim().is_empty()).unwrap_or(EMPTY);
    validate(source)?;
    let mut targets: BTreeMap<(String, String), (Option<String>, String)> = BTreeMap::new();
    for (field, value) in changes {
        let (uri, local, kind) = mapping(field).with_context(|| format!("Unsupported image field {field}"))?;
        targets.insert((uri.into(), local.into()), (value.clone(), kind.into()));
    }
    for (key, value) in custom {
        if key.is_empty() || key.len() > 80 || !key.chars().next().unwrap().is_ascii_alphabetic() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            bail!("Custom XMP keys must start with a letter and contain only letters, numbers or underscores");
        }
        targets.insert((KI.into(), key.clone()), (value.clone(), "text".into()));
    }
    if targets.is_empty() { return Ok(source.to_owned()); }
    let mut reader = Reader::from_str(source);
    let mut stack: Vec<Node> = Vec::new();
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    let mut removing: Option<(usize, usize)> = None;
    let mut insertion = None;
    loop {
        let start = reader.buffer_position() as usize;
        let event = reader.read_event().context("Malformed XMP event")?;
        let end = reader.buffer_position() as usize;
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let empty = matches!(&event, Event::Empty(_));
                let mut namespaces = stack.last().map(|p| p.namespaces.clone()).unwrap_or_default();
                for attr in e.attributes() {
                    let a = attr?; let name = String::from_utf8_lossy(a.key.as_ref()).to_string();
                    if name == "xmlns" { namespaces.insert(String::new(), String::from_utf8_lossy(&a.value).to_string()); }
                    else if let Some(p) = name.strip_prefix("xmlns:") { namespaces.insert(p.into(), String::from_utf8_lossy(&a.value).to_string()); }
                }
                let (uri, local) = expanded(e.name().as_ref(), &namespaces);
                if uri == RDF && local == "Description" {
                    for attr in e.attributes() {
                        let a = attr?;
                        if targets.contains_key(&expanded(a.key.as_ref(), &namespaces)) {
                            bail!("This XMP stores an edited property as an XML attribute. V1 will not duplicate it: select Clear descriptive metadata, then reapply the fields.");
                        }
                    }
                }
                let parent_is_description = stack.last().map(|p| p.uri == RDF && p.local == "Description").unwrap_or(false);
                if removing.is_none() && parent_is_description && targets.contains_key(&(uri.clone(), local.clone())) {
                    if empty { edits.push((start, end, String::new())); }
                    else { removing = Some((start, stack.len() + 1)); }
                }
                if empty && uri == RDF && local == "RDF" { bail!("Empty-form RDF requires clearing descriptive metadata before editing in V1"); }
                if !empty { stack.push(Node {uri, local, namespaces}); }
            }
            Event::End(_) => {
                if let Some((first, depth)) = removing {
                    if stack.len() == depth { edits.push((first, end, String::new())); removing = None; }
                }
                if stack.last().map(|n| n.uri == RDF && n.local == "RDF").unwrap_or(false) && insertion.is_none() { insertion = Some(start); }
                stack.pop();
            }
            Event::Eof => break,
            Event::DocType(_) => bail!("DTD-bearing XMP is not accepted"),
            _ => (),
        }
    }
    if !stack.is_empty() { bail!("Unclosed XMP elements"); }
    let mut body = format!("<rdf:Description xmlns:rdf=\"{RDF}\" xmlns:dc=\"{DC}\" xmlns:xmp=\"{XMP}\" xmlns:photoshop=\"{PS}\" xmlns:ki=\"{KI}\" xmlns:pdf=\"{PDF}\" rdf:about=\"\">");
    for ((uri, name), (value, kind)) in &targets {
        let Some(value) = value else { continue; };
        let prefix = match uri.as_str() { DC => "dc", XMP => "xmp", PS => "photoshop", PDF => "pdf", _ => "ki" };
        let original = value;
        let value = escape(value);
        let content = match kind.as_str() {
            "alt" => format!("<rdf:Alt><rdf:li xml:lang=\"x-default\">{value}</rdf:li></rdf:Alt>"),
            "seq" => format!("<rdf:Seq><rdf:li>{value}</rdf:li></rdf:Seq>"),
            "bag" => format!("<rdf:Bag>{}</rdf:Bag>", original.split(';').map(|s| format!("<rdf:li>{}</rdf:li>", escape(s.trim()))).collect::<String>()),
            _ => value,
        };
        body.push_str(&format!("<{prefix}:{name}>{content}</{prefix}:{name}>"));
    }
    body.push_str("</rdf:Description>");
    let at = insertion.context("XMP has no RDF container")?;
    edits.push((at, at, body)); edits.sort_by_key(|e| e.0);
    let mut output = String::new(); let mut cursor = 0;
    for (start, end, replacement) in edits {
        if start < cursor { bail!("Overlapping XMP edits"); }
        output.push_str(&source[cursor..start]); output.push_str(&replacement); cursor = end;
    }
    output.push_str(&source[cursor..]);
    // Reparse, but never serialize the DOM; unknown bytes stay as supplied.
    Element::parse(output.as_bytes()).context("Generated XMP did not validate")?;
    Ok(output)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn keywords_escape_ampersands_before_building_xml() {
        let out = patch(None, &BTreeMap::from([("keywords".into(), Some("Rock & Roll; KI".into()))]), &BTreeMap::new()).unwrap();
        assert_eq!(read(&out).unwrap()["keywords"], "Rock & Roll; KI");
    }
    #[test] fn escapes_xml_not_markup() { assert_eq!(escape("<script>&\""), "&lt;script&gt;&amp;&quot;"); }
    #[test] fn roundtrip_unicode() {
        let values = BTreeMap::from([("title".into(), Some("未来 & <KI>".into()))]);
        let xml = patch(None, &values, &BTreeMap::new()).unwrap();
        assert_eq!(read(&xml).unwrap()["title"], "未来 & <KI>");
    }
    #[test] fn edits_preserve_unknown_xml_bytes() {
        let s = format!("<rdf:RDF xmlns:rdf=\"{RDF}\" xmlns:z=\"urn:private\"><rdf:Description><z:Keep a=\"b\">untouched</z:Keep></rdf:Description></rdf:RDF>");
        let out = patch(Some(&s), &BTreeMap::from([("title".into(), Some("Changed".into()))]), &BTreeMap::new()).unwrap();
        assert!(out.contains("<z:Keep a=\"b\">untouched</z:Keep>"));
    }
    #[test] fn rejects_entity_documents() { assert!(read("<!DOCTYPE x [<!ENTITY a 'x'>]><x/>").is_err()); }
    #[test] fn removes_previous_property_instead_of_duplicating() {
        let a = patch(None, &BTreeMap::from([("title".into(), Some("Old".into()))]), &BTreeMap::new()).unwrap();
        let b = patch(Some(&a), &BTreeMap::from([("title".into(), Some("New".into()))]), &BTreeMap::new()).unwrap();
        assert!(!b.contains("Old")); assert_eq!(read(&b).unwrap()["title"], "New");
    }
    #[test] fn invalid_custom_name_is_rejected() {
        assert!(patch(None, &BTreeMap::new(), &BTreeMap::from([("bad><".into(), Some("x".into()))])).is_err());
    }
    #[test] fn deeply_nested_xmp_is_rejected_before_tree_parsing() {
        let xml = "<a>".repeat(2000) + &"</a>".repeat(2000);
        assert!(read(&xml).unwrap_err().to_string().contains("nesting"));
    }
}
