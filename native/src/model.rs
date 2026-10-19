use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawField {
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub writable: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artwork {
    pub index: usize,
    pub kind: String,
    pub mime: String,
    pub bytes: usize,
    pub description: String,
    pub data_url: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Capabilities {
    pub fields: Vec<String>,
    pub artwork: bool,
    pub raw_edit: bool,
    pub policies: Vec<String>,
    pub writer: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Inspection {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub format: String,
    pub size: u64,
    pub etag: String,
    pub fields: BTreeMap<String, String>,
    pub raw: Vec<RawField>,
    pub artwork: Vec<Artwork>,
    pub properties: Value,
    pub warnings: Vec<String>,
    pub capabilities: Capabilities,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Patch {
    #[serde(default)] pub fields: BTreeMap<String, Option<String>>,
    #[serde(default)] pub raw: Vec<RawEdit>,
    #[serde(default)] pub policy: Policy,
    #[serde(default)] pub artwork: ArtworkEdit,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawEdit {
    pub namespace: String,
    pub key: String,
    pub value: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Policy { #[default] Keep, ClearDescriptive, Privacy, StripMetadata }
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ArtworkEdit { #[default] Keep, Remove, Replace { path: String } }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveRequest {
    pub path: String,
    pub expected_etag: String,
    pub patch: Patch,
    #[serde(default)] pub output: Option<String>,
    #[serde(default)] pub replace_original: bool,
    #[serde(default)] pub allow_unverified: bool,
    #[serde(default)] pub accept_remux: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Verification {
    pub status: String,
    pub method: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub detail: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveResult {
    #[serde(default)] pub saved_at_ms: Option<u64>,
    pub output: String,
    pub backup: Option<String>,
    pub journal: Option<String>,
    pub verification: Verification,
    pub before: Inspection,
    pub after: Inspection,
    pub warnings: Vec<String>,
}
