use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct EmbedFrame {
    /// Logical X within the webview (CSS px, top-left origin).
    pub x: f64,
    /// Logical Y within the webview (CSS px, top-left origin).
    pub y: f64,
    /// Logical width in CSS points.
    pub width: f64,
    /// Logical height in CSS points.
    pub height: f64,
    /// Retina scale factor (physical / logical).
    pub scale: f64,
}
