use serde::{Deserialize, Serialize};

use crate::embed::EmbedFrame;
use crate::TimelineScene;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IpcMessage {
    Frame { frame: EmbedFrame },
    Scene { scene: TimelineScene },
    Stop,
}
