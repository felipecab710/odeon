//! wgpu surface backed by an AppKit NSView (no winit).

use core::ffi::c_void;
use core::ptr::NonNull;

use raw_window_handle::{
    AppKitDisplayHandle, AppKitWindowHandle, DisplayHandle, HandleError, HasDisplayHandle,
    HasWindowHandle, RawDisplayHandle, RawWindowHandle, WindowHandle,
};

pub struct AppKitViewSurface {
    view: NonNull<c_void>,
}

// Pointer only touched on the macOS main thread.
unsafe impl Send for AppKitViewSurface {}
unsafe impl Sync for AppKitViewSurface {}

impl AppKitViewSurface {
    pub fn new(view: *mut c_void) -> Result<Self, String> {
        NonNull::new(view as *mut c_void)
            .map(|view| Self { view })
            .ok_or_else(|| "null NSView".to_string())
    }

    pub fn as_ptr(&self) -> *mut c_void {
        self.view.as_ptr()
    }
}

impl HasWindowHandle for AppKitViewSurface {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let handle = AppKitWindowHandle::new(self.view);
        Ok(unsafe { WindowHandle::borrow_raw(RawWindowHandle::AppKit(handle)) })
    }
}

impl HasDisplayHandle for AppKitViewSurface {
    fn display_handle(&self) -> Result<DisplayHandle<'_>, HandleError> {
        let handle = AppKitDisplayHandle::new();
        Ok(unsafe { DisplayHandle::borrow_raw(RawDisplayHandle::AppKit(handle)) })
    }
}
