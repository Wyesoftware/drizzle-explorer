// Type shim: webview-bun ships raw .ts sources that do not pass our strict settings.
declare module "webview-bun" {
  import type { Pointer } from "bun:ffi";
  export enum SizeHint {
    NONE = 0,
    MIN = 1,
    MAX = 2,
    FIXED = 3,
  }
  export interface Size {
    width: number;
    height: number;
    hint: SizeHint;
  }
  export class Webview {
    constructor(debug?: boolean, size?: Size, window?: Pointer | null);
    get unsafeHandle(): Pointer | null;
    get unsafeWindowHandle(): Pointer | null;
    set size(size: Size);
    set title(title: string);
    destroy(): void;
    navigate(url: string): void;
    setHTML(html: string): void;
    run(): void;
    bind(name: string, callback: (...args: any[]) => any): void;
    unbind(name: string): void;
    eval(source: string): void;
    init(source: string): void;
  }
}
