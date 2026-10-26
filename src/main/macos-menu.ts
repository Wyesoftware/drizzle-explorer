/**
 * macOS: the webview library creates a bare NSApplication without a main menu, so the standard
 * Cmd+C / Cmd+V / Cmd+Z / Cmd+Q key equivalents do nothing. Build a minimal menu bar through the
 * Objective-C runtime so AppKit routes those shortcuts to the first responder (the WebView).
 */
import { dlopen, FFIType, JSCallback, ptr, type Pointer } from "bun:ffi";

/** Menu items that are handled by the app (forwarded to the UI); the rest use standard AppKit selectors. */
export type MenuAction = "settings" | "check-updates";

/** Callbacks, the Objective-C target and C strings must outlive this call: AppKit keeps pointers to them. */
const retained: unknown[] = [];

/** What bun:ffi returns for an `id`: a pointer, a bigint on some paths, or nil. */
type Obj = Pointer | bigint | null;

const NSEventModifierFlagCommand = 1n << 20n;
const NSEventModifierFlagShift = 1n << 17n;

/**
 * Sets the Dock icon of the running process from an image file (.icns/.png). Only needed when running
 * from source: a packaged .app gets its icon from the bundle's CFBundleIconFile.
 */
export function setMacosDockIcon(path: string): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const objc = dlopen("libobjc.A.dylib", {
      objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
      sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    });
    const send1 = dlopen("libobjc.A.dylib", {
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    }).symbols.objc_msgSend;
    // Make sure AppKit (NSImage, NSApplication) is loaded even before the webview created the app.
    dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", {
      NSApplicationLoad: { args: [], returns: FFIType.bool },
    }).symbols.NSApplicationLoad();
    const keep: Buffer[] = [];
    retained.push(keep);
    const cstr = (s: string) => {
      const buf = Buffer.from(`${s}\0`, "utf8");
      keep.push(buf);
      return ptr(buf);
    };
    const cls = (name: string) => objc.symbols.objc_getClass(cstr(name));
    const sel = (name: string) => objc.symbols.sel_registerName(cstr(name));
    const nsString = send1(cls("NSString"), sel("stringWithUTF8String:"), cstr(path));
    const image = send1(objc.symbols.objc_msgSend(cls("NSImage"), sel("alloc")), sel("initWithContentsOfFile:"), nsString);
    if (!image) return false;
    const app = objc.symbols.objc_msgSend(cls("NSApplication"), sel("sharedApplication"));
    send1(app, sel("setApplicationIconImage:"), image);
    return true;
  } catch (error) {
    console.warn("[main] could not set the Dock icon:", error);
    return false;
  }
}

export function installMacosMenu(appName: string, onAction?: (action: MenuAction) => void): boolean {
  if (process.platform !== "darwin") return false;
  try {
    // objc_msgSend is a trampoline that must be called with the target method's signature, so the
    // same symbol is declared once per signature we need.
    const objc = dlopen("libobjc.A.dylib", {
      objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
      sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    });
    const send0 = objc.symbols.objc_msgSend;
    const send1 = dlopen("libobjc.A.dylib", {
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    }).symbols.objc_msgSend;
    const send3 = dlopen("libobjc.A.dylib", {
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    }).symbols.objc_msgSend;
    const sendU64 = dlopen("libobjc.A.dylib", {
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.void },
    }).symbols.objc_msgSend;
    // Make sure AppKit classes are registered with the runtime.
    dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", {
      NSApplicationLoad: { args: [], returns: FFIType.bool },
    });

    const runtime = dlopen("libobjc.A.dylib", {
      objc_allocateClassPair: { args: [FFIType.ptr, FFIType.cstring, FFIType.u64], returns: FFIType.ptr },
      objc_registerClassPair: { args: [FFIType.ptr], returns: FFIType.void },
      class_addMethod: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.cstring], returns: FFIType.bool },
    });

    const keep: Buffer[] = []; // C strings; retained below because AppKit may keep pointers (class name)
    retained.push(keep);
    const cstr = (s: string) => {
      const buf = Buffer.from(`${s}\0`, "utf8");
      keep.push(buf);
      return ptr(buf);
    };
    const cls = (name: string) => objc.symbols.objc_getClass(cstr(name));
    const sel = (name: string) => objc.symbols.sel_registerName(cstr(name));
    const nsString = (s: string) => send1(cls("NSString"), sel("stringWithUTF8String:"), cstr(s));
    const newMenu = (title: string) => send1(send0(cls("NSMenu"), sel("alloc")), sel("initWithTitle:"), nsString(title));
    const addItem = (menu: Obj, title: string, action: string, key: string, modifiers?: bigint) => {
      const item = send3(menu, sel("addItemWithTitle:action:keyEquivalent:"), nsString(title), sel(action), nsString(key));
      if (modifiers !== undefined) sendU64(item, sel("setKeyEquivalentModifierMask:"), modifiers);
      return item;
    };
    const addSeparator = (menu: Obj) =>
      send1(menu, sel("addItem:"), send0(cls("NSMenuItem"), sel("separatorItem")));
    const attach = (bar: Obj, submenu: Obj) => {
      const holder = send0(send0(cls("NSMenuItem"), sel("alloc")), sel("init"));
      send1(holder, sel("setSubmenu:"), submenu);
      send1(bar, sel("addItem:"), holder);
    };

    // App-handled items need an Objective-C target: a tiny NSObject subclass whose methods are bun:ffi
    // callbacks (they run on this thread, inside the AppKit run loop that webview.run() drives).
    let target: Obj = null;
    if (onAction) {
      const callback = (action: MenuAction) =>
        new JSCallback(
          () => {
            try {
              onAction(action);
            } catch (error) {
              console.error("[main] menu action failed:", error);
            }
          },
          { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
        );
      const settingsCallback = callback("settings");
      const updatesCallback = callback("check-updates");
      const targetClass = runtime.symbols.objc_allocateClassPair(cls("NSObject"), cstr("DrizzleExplorerMenuTarget"), 0n);
      runtime.symbols.class_addMethod(targetClass, sel("openSettings:"), settingsCallback.ptr, cstr("v@:@"));
      runtime.symbols.class_addMethod(targetClass, sel("checkForUpdates:"), updatesCallback.ptr, cstr("v@:@"));
      runtime.symbols.objc_registerClassPair(targetClass);
      target = send0(send0(targetClass, sel("alloc")), sel("init"));
      retained.push(settingsCallback, updatesCallback, target);
    }
    const addAppItem = (menu: Obj, title: string, action: string, key: string) => {
      const item = addItem(menu, title, action, key);
      send1(item, sel("setTarget:"), target);
      return item;
    };

    const bar = newMenu("");

    const appMenu = newMenu(appName);
    addItem(appMenu, `About ${appName}`, "orderFrontStandardAboutPanel:", "");
    if (target) addAppItem(appMenu, "Check for Updates…", "checkForUpdates:", "");
    addSeparator(appMenu);
    if (target) addAppItem(appMenu, "Settings…", "openSettings:", ",");
    addSeparator(appMenu);
    addItem(appMenu, `Hide ${appName}`, "hide:", "h");
    addItem(appMenu, "Hide Others", "hideOtherApplications:", "h", NSEventModifierFlagCommand | (1n << 19n) /* option */);
    addSeparator(appMenu);
    addItem(appMenu, `Quit ${appName}`, "terminate:", "q");
    attach(bar, appMenu);

    const edit = newMenu("Edit");
    addItem(edit, "Undo", "undo:", "z");
    addItem(edit, "Redo", "redo:", "z", NSEventModifierFlagCommand | NSEventModifierFlagShift);
    addSeparator(edit);
    addItem(edit, "Cut", "cut:", "x");
    addItem(edit, "Copy", "copy:", "c");
    addItem(edit, "Paste", "paste:", "v");
    addItem(edit, "Delete", "delete:", "");
    addItem(edit, "Select All", "selectAll:", "a");
    attach(bar, edit);

    const view = newMenu("View");
    addItem(view, "Reload", "reload:", "r");
    addItem(view, "Enter Full Screen", "toggleFullScreen:", "f", NSEventModifierFlagCommand | (1n << 18n) /* control */);
    attach(bar, view);

    const windowMenu = newMenu("Window");
    addItem(windowMenu, "Minimize", "performMiniaturize:", "m");
    addItem(windowMenu, "Zoom", "performZoom:", "");
    addItem(windowMenu, "Close", "performClose:", "w");
    attach(bar, windowMenu);

    const app = send0(cls("NSApplication"), sel("sharedApplication"));
    send1(app, sel("setMainMenu:"), bar);
    send1(app, sel("setWindowsMenu:"), windowMenu);
    return true;
  } catch (error) {
    console.warn("[main] could not install macOS menu:", error);
    return false;
  }
}
